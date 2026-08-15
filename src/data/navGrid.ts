import { NAV_CELL_SIZE } from '../config/gameConfig';
import type { NavGridDefinition, Vec2 } from '../core/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Builds an authored navigation grid by starting fully walkable and carving
 * out blockers. Authoring maps as rectangles keeps the structural layout
 * readable in source and reviewable in a diff, which hand-written cell arrays
 * are not.
 */
export function buildNavGrid(worldSize: Vec2, blockers: Rect[], cellSize = NAV_CELL_SIZE): NavGridDefinition {
  const width = Math.ceil(worldSize.x / cellSize);
  const height = Math.ceil(worldSize.y / cellSize);
  const cells = new Array<number>(width * height).fill(1);

  for (const rect of blockers) {
    const c0 = Math.max(0, Math.floor(rect.x / cellSize));
    const r0 = Math.max(0, Math.floor(rect.y / cellSize));
    const c1 = Math.min(width - 1, Math.ceil((rect.x + rect.width) / cellSize) - 1);
    const r1 = Math.min(height - 1, Math.ceil((rect.y + rect.height) / cellSize) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        cells[r * width + c] = 0;
      }
    }
  }

  return { cellSize, width, height, cells };
}

export function isWalkable(grid: NavGridDefinition, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return false;
  return grid.cells[row * grid.width + col] === 1;
}

export function worldToCell(grid: NavGridDefinition, point: Vec2): { col: number; row: number } {
  return {
    col: Math.floor(point.x / grid.cellSize),
    row: Math.floor(point.y / grid.cellSize),
  };
}

export function cellToWorld(grid: NavGridDefinition, col: number, row: number): Vec2 {
  return {
    x: col * grid.cellSize + grid.cellSize / 2,
    y: row * grid.cellSize + grid.cellSize / 2,
  };
}

/**
 * Nearest walkable cell to a point, searched in expanding rings. Used when a
 * tap lands on a wall or a station body - the player gets the sensible edge
 * rather than a rejected command.
 */
export function nearestWalkable(
  grid: NavGridDefinition,
  point: Vec2,
  maxRadius = 8,
): { col: number; row: number } | null {
  const { col, row } = worldToCell(grid, point);
  if (isWalkable(grid, col, row)) return { col, row };

  for (let radius = 1; radius <= maxRadius; radius++) {
    // Deterministic scan order so identical inputs always pick the same cell.
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
        if (isWalkable(grid, col + dc, row + dr)) {
          return { col: col + dc, row: row + dr };
        }
      }
    }
  }
  return null;
}
