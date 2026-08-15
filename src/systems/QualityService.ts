import { MAX_PIXEL_RATIO_HIGH, MAX_PIXEL_RATIO_LOW } from '../config/gameConfig';
import type { PlayerSettings } from '../core/types';

export type QualityLevel = 'LOW' | 'HIGH';

/**
 * Fill rate, not CPU, is what costs frames on a phone, so the backing store is
 * capped rather than the simulation being thinned (design document section 29).
 *
 * AUTO measures actual frame times during play and steps down once - never
 * back up, because oscillating quality is more distracting than a slightly
 * softer image.
 */
export class QualityService {
  private level: QualityLevel = 'HIGH';
  private samples: number[] = [];
  private locked = false;

  constructor(settings: PlayerSettings) {
    this.applySettings(settings);
  }

  applySettings(settings: PlayerSettings): void {
    if (settings.quality === 'LOW') {
      this.level = 'LOW';
      this.locked = true;
    } else if (settings.quality === 'HIGH') {
      this.level = 'HIGH';
      this.locked = true;
    } else {
      this.locked = false;
      // Start optimistic; a slow device demotes itself within a few seconds.
      this.level = 'HIGH';
    }
  }

  get currentLevel(): QualityLevel {
    return this.level;
  }

  get pixelRatioCap(): number {
    return this.level === 'HIGH' ? MAX_PIXEL_RATIO_HIGH : MAX_PIXEL_RATIO_LOW;
  }

  /** Particle budget multiplier for the feedback system. */
  get effectScale(): number {
    return this.level === 'HIGH' ? 1 : 0.5;
  }

  /**
   * Feeds one frame delta in. Returns true when the level changed, so the
   * caller can re-apply the pixel ratio.
   */
  sample(deltaMs: number): boolean {
    if (this.locked || this.level === 'LOW') return false;

    this.samples.push(deltaMs);
    if (this.samples.length < 90) return false;

    const sorted = this.samples.slice().sort((a, b) => a - b);
    // Ninetieth percentile: a couple of slow frames should not demote a device
    // that is otherwise comfortable.
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    this.samples = [];

    if (p90 > 26) {
      this.level = 'LOW';
      return true;
    }
    return false;
  }

  reset(): void {
    this.samples = [];
  }
}
