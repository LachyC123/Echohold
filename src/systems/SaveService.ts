import { DEFAULT_SETTINGS } from '../config/defaultSettings';
import { CURRENT_SAVE_VERSION, type MedalTier, type PlayerSettings, type SaveDataV1 } from '../core/types';

const PRIMARY_KEY = 'echohold.save.v1';
const BACKUP_KEY = 'echohold.save.v1.backup';
const STAGING_KEY = 'echohold.save.v1.staging';

/** Minimal storage surface, so tests can run without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export type LoadOutcome =
  | { status: 'LOADED'; data: SaveDataV1 }
  | { status: 'NEW'; data: SaveDataV1 }
  | { status: 'RECOVERED'; data: SaveDataV1; message: string }
  | { status: 'CORRUPT'; data: SaveDataV1; message: string };

const MEDAL_TIERS: MedalTier[] = ['BRONZE', 'SILVER', 'GOLD'];

/**
 * Versioned local persistence (design document section 25).
 *
 * Writes go to a staging key first, are read back and validated, and only then
 * promoted to the primary key - with the previous good value kept as a backup.
 * A half-written save can therefore never be the only copy, which is the
 * failure mode that loses a player's campaign.
 *
 * Live engine objects and functions are never stored; only plain data.
 */
export class SaveService {
  constructor(private readonly storage: StorageLike = resolveStorage()) {}

  createNew(): SaveDataV1 {
    const now = new Date().toISOString();
    return {
      schemaVersion: CURRENT_SAVE_VERSION,
      createdAtIso: now,
      updatedAtIso: now,
      completedScenarioIds: [],
      medalByScenarioId: {},
      memoryShards: 0,
      stability: 0,
      unlockedUpgradeIds: [],
      discoveredRelicIds: [],
      residentStates: {},
      restoredHubSectionIds: [],
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  load(): LoadOutcome {
    const primary = this.readKey(PRIMARY_KEY);
    if (primary) return { status: 'LOADED', data: primary };

    const backup = this.readKey(BACKUP_KEY);
    if (backup) {
      return {
        status: 'RECOVERED',
        data: backup,
        message: 'The most recent save could not be read. An earlier backup was restored.',
      };
    }

    const rawPrimary = this.storage.getItem(PRIMARY_KEY);
    if (rawPrimary !== null) {
      // Something is there but neither it nor the backup parses.
      return {
        status: 'CORRUPT',
        data: this.createNew(),
        message: 'The saved campaign could not be read and no backup survived.',
      };
    }
    return { status: 'NEW', data: this.createNew() };
  }

  /** Returns true on success. Never throws - storage can be full or blocked. */
  save(data: SaveDataV1): boolean {
    try {
      const payload: SaveDataV1 = { ...data, updatedAtIso: new Date().toISOString() };
      const serialised = JSON.stringify(payload);

      // Stage, read back, then promote. A truncated quota-exceeded write fails
      // the read-back and leaves the primary key untouched.
      this.storage.setItem(STAGING_KEY, serialised);
      const verified = this.parse(this.storage.getItem(STAGING_KEY));
      if (!verified) throw new Error('staged save failed validation');

      const previous = this.storage.getItem(PRIMARY_KEY);
      if (previous !== null) this.storage.setItem(BACKUP_KEY, previous);
      this.storage.setItem(PRIMARY_KEY, serialised);
      this.storage.removeItem(STAGING_KEY);
      return true;
    } catch {
      try {
        this.storage.removeItem(STAGING_KEY);
      } catch {
        /* storage is unavailable entirely; nothing further to do */
      }
      return false;
    }
  }

  reset(): void {
    this.storage.removeItem(PRIMARY_KEY);
    this.storage.removeItem(BACKUP_KEY);
    this.storage.removeItem(STAGING_KEY);
  }

  /** Human-readable export for the Settings panel. */
  exportJson(data: SaveDataV1): string {
    return JSON.stringify(data, null, 2);
  }

  importJson(json: string): SaveDataV1 | null {
    return this.parse(json);
  }

  private readKey(key: string): SaveDataV1 | null {
    return this.parse(this.storage.getItem(key));
  }

  /**
   * Parses and repairs. Unknown fields are dropped and missing ones are filled
   * from defaults, so a save written by an older build still loads rather than
   * being declared corrupt.
   */
  private parse(raw: string | null): SaveDataV1 | null {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Partial<SaveDataV1>;
    const migrated = this.migrate(candidate);
    if (!migrated) return null;
    return migrated;
  }

  /** Schema migrations. Version 1 is the first shipped format. */
  private migrate(candidate: Partial<SaveDataV1>): SaveDataV1 | null {
    const version = candidate.schemaVersion;
    if (typeof version !== 'number' || version < 1) return null;
    if (version > CURRENT_SAVE_VERSION) {
      // A newer build wrote this. Refuse rather than silently discarding data.
      return null;
    }

    const base = this.createNew();
    return {
      ...base,
      ...candidate,
      schemaVersion: CURRENT_SAVE_VERSION,
      createdAtIso: typeof candidate.createdAtIso === 'string' ? candidate.createdAtIso : base.createdAtIso,
      updatedAtIso: typeof candidate.updatedAtIso === 'string' ? candidate.updatedAtIso : base.updatedAtIso,
      completedScenarioIds: asStringArray(candidate.completedScenarioIds),
      medalByScenarioId: asMedalMap(candidate.medalByScenarioId),
      memoryShards: asNumber(candidate.memoryShards, 0),
      stability: asNumber(candidate.stability, 0),
      unlockedUpgradeIds: asStringArray(candidate.unlockedUpgradeIds),
      discoveredRelicIds: asStringArray(candidate.discoveredRelicIds),
      restoredHubSectionIds: asStringArray(candidate.restoredHubSectionIds),
      residentStates: typeof candidate.residentStates === 'object' && candidate.residentStates !== null
        ? candidate.residentStates
        : {},
      settings: mergeSettings(candidate.settings),
    };
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asMedalMap(value: unknown): Record<string, MedalTier> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, MedalTier> = {};
  for (const [key, medal] of Object.entries(value as Record<string, unknown>)) {
    if (typeof medal === 'string' && (MEDAL_TIERS as string[]).includes(medal)) {
      out[key] = medal as MedalTier;
    }
  }
  return out;
}

function mergeSettings(value: unknown): PlayerSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS };
  const partial = value as Partial<PlayerSettings>;
  const merged: PlayerSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof PlayerSettings>) {
    const incoming = partial[key];
    if (incoming !== undefined && typeof incoming === typeof DEFAULT_SETTINGS[key]) {
      // Types line up by construction; the cast keeps the loop generic.
      (merged[key] as unknown) = incoming;
    }
  }
  return merged;
}

function resolveStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') {
      // Private-browsing modes expose localStorage but throw on write.
      const probe = '__echohold_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  return new MemoryStorage();
}
