import type { PlayerSettings, SaveDataV1 } from './core/types';
import { AudioService } from './systems/AudioService';
import { ProgressionSystem } from './systems/ProgressionSystem';
import { QualityService } from './systems/QualityService';
import { SaveService, type LoadOutcome } from './systems/SaveService';

/**
 * Services shared across scenes, created once at boot.
 *
 * Held in the Phaser registry rather than a module-level singleton so that a
 * full restart of the game object leaves nothing behind - the restart
 * regression depends on there being no hidden global state.
 */
export class GameContext {
  readonly saves = new SaveService();
  readonly progression: ProgressionSystem;
  readonly audio: AudioService;
  readonly quality: QualityService;

  save: SaveDataV1;
  /** Non-null when the last load recovered from backup or found corruption. */
  loadNotice: string | null = null;

  constructor() {
    const outcome: LoadOutcome = this.saves.load();
    this.save = outcome.data;
    if (outcome.status === 'RECOVERED' || outcome.status === 'CORRUPT') {
      this.loadNotice = outcome.message;
    }
    this.progression = new ProgressionSystem(this.saves);
    this.audio = new AudioService(this.save.settings);
    this.quality = new QualityService(this.save.settings);
  }

  get settings(): PlayerSettings {
    return this.save.settings;
  }

  updateSettings(patch: Partial<PlayerSettings>): void {
    this.save = { ...this.save, settings: { ...this.save.settings, ...patch } };
    this.audio.setSettings(this.save.settings);
    this.quality.applySettings(this.save.settings);
    this.persist();
  }

  setSave(save: SaveDataV1): void {
    this.save = save;
  }

  persist(): boolean {
    return this.saves.save(this.save);
  }

  hasCompleted(scenarioId: string): boolean {
    return this.save.completedScenarioIds.includes(scenarioId);
  }

  /** True when there is anything worth continuing. */
  get hasProgress(): boolean {
    return this.save.completedScenarioIds.length > 0;
  }
}

export const CONTEXT_KEY = 'echohold-context';
