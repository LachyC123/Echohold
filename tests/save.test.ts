import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/defaultSettings';
import { BROKEN_GATE } from '../src/data/scenarios/brokenGate';
import { ProgressionSystem } from '../src/systems/ProgressionSystem';
import { MemoryStorage, SaveService, type StorageLike } from '../src/systems/SaveService';

describe('SaveService', () => {
  it('starts a new campaign when nothing is stored', () => {
    const saves = new SaveService(new MemoryStorage());
    const outcome = saves.load();
    expect(outcome.status).toBe('NEW');
    expect(outcome.data.schemaVersion).toBe(1);
    expect(outcome.data.completedScenarioIds).toEqual([]);
  });

  it('round-trips stable data', () => {
    const saves = new SaveService(new MemoryStorage());
    const save = saves.createNew();
    save.completedScenarioIds.push('broken_gate');
    save.medalByScenarioId['broken_gate'] = 'GOLD';
    save.memoryShards = 7;
    save.restoredHubSectionIds.push('gatehouse');

    expect(saves.save(save)).toBe(true);

    const loaded = saves.load();
    expect(loaded.status).toBe('LOADED');
    expect(loaded.data.completedScenarioIds).toEqual(['broken_gate']);
    expect(loaded.data.medalByScenarioId['broken_gate']).toBe('GOLD');
    expect(loaded.data.memoryShards).toBe(7);
    expect(loaded.data.restoredHubSectionIds).toEqual(['gatehouse']);
  });

  it('keeps the previous good snapshot as a backup', () => {
    const storage = new MemoryStorage();
    const saves = new SaveService(storage);

    const first = saves.createNew();
    first.memoryShards = 1;
    saves.save(first);

    const second = saves.createNew();
    second.memoryShards = 2;
    saves.save(second);

    expect(saves.load().data.memoryShards).toBe(2);

    // Corrupt the primary key only.
    storage.setItem('echohold.save.v1', '{ this is not json');
    const recovered = saves.load();
    expect(recovered.status).toBe('RECOVERED');
    expect(recovered.data.memoryShards).toBe(1);
    if (recovered.status === 'RECOVERED') expect(recovered.message).toMatch(/backup/i);
  });

  it('reports corruption rather than silently starting over', () => {
    const storage = new MemoryStorage();
    storage.setItem('echohold.save.v1', 'not json at all');
    const outcome = new SaveService(storage).load();
    expect(outcome.status).toBe('CORRUPT');
    expect(outcome.data.completedScenarioIds).toEqual([]);
  });

  it('never promotes a write that fails read-back', () => {
    // A quota-exceeded browser: writes appear to work but store nothing.
    const storage: StorageLike = {
      getItem: (key) => (key === 'echohold.save.v1' ? JSON.stringify(good) : null),
      setItem: () => {},
      removeItem: () => {},
    };
    const saves = new SaveService(storage);
    const good = saves.createNew();

    expect(saves.save(good)).toBe(false);
    // The existing good save is still readable.
    expect(saves.load().status).toBe('LOADED');
  });

  it('fills in fields a shorter, older save is missing', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'echohold.save.v1',
      JSON.stringify({ schemaVersion: 1, completedScenarioIds: ['broken_gate'] }),
    );
    const outcome = new SaveService(storage).load();
    expect(outcome.status).toBe('LOADED');
    expect(outcome.data.completedScenarioIds).toEqual(['broken_gate']);
    expect(outcome.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(outcome.data.memoryShards).toBe(0);
  });

  it('refuses a save written by a newer build rather than dropping its data', () => {
    const storage = new MemoryStorage();
    storage.setItem('echohold.save.v1', JSON.stringify({ schemaVersion: 99, memoryShards: 12 }));
    expect(new SaveService(storage).load().status).toBe('CORRUPT');
  });

  it('exports and re-imports a human-readable save', () => {
    const saves = new SaveService(new MemoryStorage());
    const save = saves.createNew();
    save.memoryShards = 4;
    save.unlockedUpgradeIds.push('handoff');

    const json = saves.exportJson(save);
    expect(json).toContain('\n'); // pretty-printed, so a person can read it
    const imported = saves.importJson(json);

    expect(imported?.memoryShards).toBe(4);
    expect(imported?.unlockedUpgradeIds).toEqual(['handoff']);
    expect(saves.importJson('garbage')).toBeNull();
  });

  it('discards a hostile medal value instead of trusting it', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'echohold.save.v1',
      JSON.stringify({ schemaVersion: 1, medalByScenarioId: { broken_gate: 'PLATINUM' } }),
    );
    const outcome = new SaveService(storage).load();
    expect(outcome.data.medalByScenarioId['broken_gate']).toBeUndefined();
  });
});

describe('ProgressionSystem', () => {
  const setup = () => {
    const saves = new SaveService(new MemoryStorage());
    return { saves, progression: new ProgressionSystem(saves), save: saves.createNew() };
  };

  it('grants stability and a visible restoration on first completion', () => {
    const { progression, save } = setup();
    const outcome = progression.applyCompletion(save, BROKEN_GATE, 'BRONZE');

    expect(outcome.isFirstCompletion).toBe(true);
    expect(outcome.save.stability).toBe(1);
    expect(outcome.save.restoredHubSectionIds).toContain('gatehouse');
    expect(outcome.save.completedScenarioIds).toEqual(['broken_gate']);
    expect(outcome.rewards.some((r) => r.kind === 'UPGRADE_CHOICE')).toBe(true);
  });

  it('never re-awards stability or a restoration on a replay', () => {
    const { progression, save } = setup();
    const first = progression.applyCompletion(save, BROKEN_GATE, 'BRONZE');
    const second = progression.applyCompletion(first.save, BROKEN_GATE, 'BRONZE');

    expect(second.isFirstCompletion).toBe(false);
    expect(second.save.stability).toBe(1);
    expect(second.save.restoredHubSectionIds).toEqual(['gatehouse']);
  });

  it('upgrades a medal but never downgrades one', () => {
    const { progression, save } = setup();
    const bronze = progression.applyCompletion(save, BROKEN_GATE, 'BRONZE');
    const gold = progression.applyCompletion(bronze.save, BROKEN_GATE, 'GOLD');
    const backToBronze = progression.applyCompletion(gold.save, BROKEN_GATE, 'BRONZE');

    expect(gold.save.medalByScenarioId['broken_gate']).toBe('GOLD');
    expect(backToBronze.save.medalByScenarioId['broken_gate']).toBe('GOLD');
  });

  it('pays shards for mastery only, so story progress never needs grinding', () => {
    const { progression, save } = setup();
    const bronze = progression.applyCompletion(save, BROKEN_GATE, 'BRONZE');
    expect(bronze.save.memoryShards).toBe(0);

    const gold = progression.applyCompletion(bronze.save, BROKEN_GATE, 'GOLD');
    expect(gold.save.memoryShards).toBe(5);

    // Re-earning the same medal pays nothing.
    const again = progression.applyCompletion(gold.save, BROKEN_GATE, 'GOLD');
    expect(again.save.memoryShards).toBe(5);
  });

  it('stops offering an upgrade the player already owns', () => {
    const { progression, save } = setup();
    const first = progression.applyCompletion(save, BROKEN_GATE, 'BRONZE');
    const chosen = progression.chooseUpgrade(first.save, 'handoff');

    const second = progression.applyCompletion(chosen, BROKEN_GATE, 'SILVER');
    const choice = second.rewards.find((r) => r.kind === 'UPGRADE_CHOICE');
    expect(choice?.options).toEqual(['swift_boots']);
  });
});
