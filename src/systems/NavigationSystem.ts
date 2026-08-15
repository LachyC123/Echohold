import type { NavGridDefinition, Vec2 } from '../core/types';
import { cellToWorld, isWalkable, nearestWalkable, worldToCell } from '../data/navGrid';

interface Node {
  index: number;
  g: number;
  f: number;
  h: number;
  order: number;
  parent: number;
}

const SQRT2 = Math.SQRT2;

/** Eight-way neighbours, in a fixed order so ties always resolve identically. */
const NEIGHBOURS: Array<{ dc: number; dr: number; cost: number }> = [
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 1, dr: -1, cost: SQRT2 },
  { dc: 1, dr: 1, cost: SQRT2 },
  { dc: -1, dr: 1, cost: SQRT2 },
  { dc: -1, dr: -1, cost: SQRT2 },
];

/**
 * Small deterministic grid pathfinder owned by the project (design document
 * section 24).
 *
 * Determinism comes from three things: a fixed neighbour order, a total
 * ordering in the open set that falls back to insertion index, and integer
 * cell arithmetic. Two runs on the same grid always return the identical path,
 * which is what the batch validation test relies on.
 *
 * Paths are only recomputed when a path becomes invalid or a target changes
 * state; idle actors never pathfind (section 29).
 */
export class NavigationSystem {
  private readonly width: number;
  private readonly height: number;
  // Reused scratch buffers - no per-call array allocation in the hot path.
  private readonly gScores: Float64Array;
  private readonly visitedStamp: Int32Array;
  private readonly closedStamp: Int32Array;
  private readonly parents: Int32Array;
  private stamp = 0;
  private openHeap: Node[] = [];

  constructor(private readonly grid: NavGridDefinition) {
    this.width = grid.width;
    this.height = grid.height;
    const size = this.width * this.height;
    this.gScores = new Float64Array(size);
    this.visitedStamp = new Int32Array(size);
    this.closedStamp = new Int32Array(size);
    this.parents = new Int32Array(size);
  }

  get definition(): NavGridDefinition {
    return this.grid;
  }

  isPointWalkable(point: Vec2): boolean {
    const { col, row } = worldToCell(this.grid, point);
    return isWalkable(this.grid, col, row);
  }

  /** Snaps a point to the closest walkable cell centre, or null if enclosed. */
  snap(point: Vec2): Vec2 | null {
    const cell = nearestWalkable(this.grid, point);
    return cell ? cellToWorld(this.grid, cell.col, cell.row) : null;
  }

  /**
   * Finds a world-space path from `from` to `to`.
   *
   * The path always ends on the exact destination, not on the centre of the
   * destination cell. Interaction slots sit at authored offsets that rarely
   * coincide with a cell centre, and an actor that stops a few pixels short
   * never satisfies its arrival check - it re-paths, arrives short again, and
   * eventually times out for no reason the player can see.
   *
   * Returns null when no route exists.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const startCell = nearestWalkable(this.grid, from);
    const goalCell = nearestWalkable(this.grid, to);
    if (!startCell || !goalCell) return null;

    const goalPoint = this.isPointWalkable(to) ? { x: to.x, y: to.y } : cellToWorld(this.grid, goalCell.col, goalCell.row);

    const start = startCell.row * this.width + startCell.col;
    const goal = goalCell.row * this.width + goalCell.col;
    if (start === goal) {
      // Same cell: a straight step, unless the actor is already standing there.
      return Math.hypot(goalPoint.x - from.x, goalPoint.y - from.y) < 1e-6 ? [] : [goalPoint];
    }

    this.stamp += 1;
    const stamp = this.stamp;
    this.openHeap.length = 0;
    let order = 0;

    this.gScores[start] = 0;
    this.visitedStamp[start] = stamp;
    this.parents[start] = -1;
    this.push({
      index: start,
      g: 0,
      h: this.heuristic(start, goal),
      f: this.heuristic(start, goal),
      order: order++,
      parent: -1,
    });

    while (this.openHeap.length > 0) {
      const current = this.pop()!;
      if (this.closedStamp[current.index] === stamp) continue;
      this.closedStamp[current.index] = stamp;

      if (current.index === goal) {
        return this.reconstruct(start, goal, from, goalPoint);
      }

      const col = current.index % this.width;
      const row = (current.index - col) / this.width;

      for (const n of NEIGHBOURS) {
        const nc = col + n.dc;
        const nr = row + n.dr;
        if (!isWalkable(this.grid, nc, nr)) continue;
        // Never cut a corner through a blocked cell - it looks like clipping
        // through a wall and makes an Echo's replay indefensible.
        if (n.dc !== 0 && n.dr !== 0) {
          if (!isWalkable(this.grid, col + n.dc, row) || !isWalkable(this.grid, col, row + n.dr)) {
            continue;
          }
        }
        const nIndex = nr * this.width + nc;
        if (this.closedStamp[nIndex] === stamp) continue;

        const tentative = current.g + n.cost;
        const known = this.visitedStamp[nIndex] === stamp ? this.gScores[nIndex]! : Infinity;
        if (tentative < known - 1e-9) {
          this.visitedStamp[nIndex] = stamp;
          this.gScores[nIndex] = tentative;
          this.parents[nIndex] = current.index;
          const h = this.heuristic(nIndex, goal);
          this.push({ index: nIndex, g: tentative, h, f: tentative + h, order: order++, parent: current.index });
        }
      }
    }
    return null;
  }

  private reconstruct(start: number, goal: number, from: Vec2, goalPoint: Vec2): Vec2[] {
    const cells: number[] = [];
    let cursor = goal;
    let guard = 0;
    while (cursor !== start && guard++ < this.width * this.height) {
      cells.push(cursor);
      cursor = this.parents[cursor]!;
      if (cursor < 0) break;
    }
    cells.reverse();

    const path = this.smooth(start, cells);
    // Swap the final cell centre for the true destination when the last leg
    // is clear; otherwise append it as one extra short step.
    const penultimate = path.length >= 2 ? path[path.length - 2]! : from;
    if (path.length > 0 && this.hasLineOfSight(penultimate, goalPoint)) {
      path[path.length - 1] = goalPoint;
    } else {
      path.push(goalPoint);
    }
    return path;
  }

  /**
   * String-pulling: drop intermediate waypoints that a straight line already
   * clears. Turns the raw staircase into the diagonal a person would walk,
   * and shortens the list the actor has to follow each tick.
   */
  private smooth(start: number, cells: number[]): Vec2[] {
    const toPoint = (index: number): Vec2 => {
      const col = index % this.width;
      const row = (index - col) / this.width;
      return cellToWorld(this.grid, col, row);
    };

    const out: Vec2[] = [];
    let anchorIndex = start;
    let i = 0;
    while (i < cells.length) {
      let furthest = i;
      for (let j = cells.length - 1; j > i; j--) {
        if (this.hasLineOfSight(toPoint(anchorIndex), toPoint(cells[j]!))) {
          furthest = j;
          break;
        }
      }
      out.push(toPoint(cells[furthest]!));
      anchorIndex = cells[furthest]!;
      i = furthest + 1;
    }
    return out;
  }

  /** Sampled straight-line walkability test at half-cell resolution. */
  hasLineOfSight(a: Vec2, b: Vec2): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / (this.grid.cellSize * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const x = a.x + dx * p;
      const y = a.y + dy * p;
      const col = Math.floor(x / this.grid.cellSize);
      const row = Math.floor(y / this.grid.cellSize);
      if (!isWalkable(this.grid, col, row)) return false;
    }
    return true;
  }

  private heuristic(from: number, to: number): number {
    const fc = from % this.width;
    const fr = (from - fc) / this.width;
    const tc = to % this.width;
    const tr = (to - tc) / this.width;
    const dx = Math.abs(fc - tc);
    const dy = Math.abs(fr - tr);
    // Octile distance - admissible for eight-way movement.
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  // --- Binary heap with a total ordering (f, h, insertion order) -----------

  private push(node: Node): void {
    const heap = this.openHeap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(heap[i]!, heap[parent]!)) {
        const tmp = heap[i]!;
        heap[i] = heap[parent]!;
        heap[parent] = tmp;
        i = parent;
      } else break;
    }
  }

  private pop(): Node | undefined {
    const heap = this.openHeap;
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && this.less(heap[l]!, heap[smallest]!)) smallest = l;
        if (r < heap.length && this.less(heap[r]!, heap[smallest]!)) smallest = r;
        if (smallest === i) break;
        const tmp = heap[i]!;
        heap[i] = heap[smallest]!;
        heap[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }

  private less(a: Node, b: Node): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    return a.order < b.order;
  }
}
