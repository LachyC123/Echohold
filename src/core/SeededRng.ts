/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * Game rules must never call Math.random(). Every stochastic decision inside a
 * scenario draws from an instance of this class so that the same seed and the
 * same command stream always produce the same logical result, regardless of
 * frame rate or device.
 */
export class SeededRng {
  private state: number;

  constructor(public readonly seed: number) {
    // Keep the state in unsigned 32-bit space; seed 0 would otherwise stall.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  /** Float in [min, max). */
  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Picks one element; returns undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.nextInt(0, items.length)];
  }

  /** Fisher-Yates over a copy, so callers cannot accidentally mutate data. */
  shuffled<T>(items: readonly T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const a = copy[i]!;
      const b = copy[j]!;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }

  /** Snapshot/restore lets a scenario rewind without re-deriving the seed. */
  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** A fresh generator on the same seed, back at tick zero. */
  fork(salt: number): SeededRng {
    return new SeededRng((this.seed ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
  }
}
