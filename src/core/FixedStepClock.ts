import { TICKS_PER_SECOND } from '../config/gameConfig';

/**
 * Accumulator that converts wall-clock frame deltas into a whole number of
 * fixed simulation ticks.
 *
 * The authoritative simulation runs at exactly {@link TICKS_PER_SECOND}. The
 * renderer may run at 30, 60 or 120 FPS and the logical outcome must not
 * change. After a tab restore the delta can be enormous, so it is clamped
 * rather than replayed - catching up on 40 seconds of simulation would freeze
 * the page and desynchronise the player from their own recording.
 */
export class FixedStepClock {
  readonly stepMs: number;
  private accumulatorMs = 0;
  private tick = 0;
  private paused = false;

  constructor(
    private readonly ticksPerSecond: number = TICKS_PER_SECOND,
    /** Frame deltas beyond this are treated as a stall, not as elapsed time. */
    private readonly maxFrameDeltaMs: number = 250,
  ) {
    this.stepMs = 1000 / ticksPerSecond;
  }

  get currentTick(): number {
    return this.tick;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Fraction of the way into the next tick; used to interpolate rendering. */
  get alpha(): number {
    return Math.min(1, this.accumulatorMs / this.stepMs);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    // Drop the partial accumulation so resuming never emits a burst of ticks.
    if (paused) this.accumulatorMs = 0;
  }

  reset(): void {
    this.accumulatorMs = 0;
    this.tick = 0;
    this.paused = false;
  }

  /**
   * Advances the accumulator and invokes `onTick` once per elapsed step.
   * Returns the number of ticks executed this frame.
   */
  advance(deltaMs: number, onTick: (tick: number) => void): number {
    if (this.paused) return 0;

    const clamped = Math.min(Math.max(deltaMs, 0), this.maxFrameDeltaMs);
    this.accumulatorMs += clamped;

    let steps = 0;
    while (this.accumulatorMs >= this.stepMs) {
      this.accumulatorMs -= this.stepMs;
      this.tick += 1;
      steps += 1;
      onTick(this.tick);
    }
    return steps;
  }

  secondsToTicks(seconds: number): number {
    return Math.round(seconds * this.ticksPerSecond);
  }

  ticksToSeconds(ticks: number): number {
    return ticks / this.ticksPerSecond;
  }
}
