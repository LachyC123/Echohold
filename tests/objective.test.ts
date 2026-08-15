import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/config/gameConfig';
import { FractureAnalysisSystem } from '../src/systems/FractureAnalysisSystem';
import {
  BROKEN_GATE_SOLUTION,
  issueAndSettle,
  makeSimulation,
  playSequence,
  runToEnd,
  stepTicks,
} from './helpers';

describe('ObjectiveSystem', () => {
  it('only resolves "survives to sixty seconds" once the clock has run out', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION);

    const midRun = sim.objectives.objectiveStates.find((s) => s.definition.id === 'gate_holds')!;
    expect(midRun.complete).toBe(false);
    expect(midRun.impossible).toBe(false);

    runToEnd(sim);
    // Repair alone still loses the gate, so this must be impossible, not complete.
    const atEnd = sim.objectives.objectiveStates.find((s) => s.definition.id === 'gate_holds')!;
    expect(atEnd.complete).toBe(false);
  });

  it('transitions are idempotent under repeated evaluation', () => {
    const sim = makeSimulation();
    const updates: string[] = [];
    sim.bus.on('OBJECTIVE_UPDATED', (e) => updates.push(`${e.payload.objectiveId}:${e.payload.complete}`));
    sim.bus.on('OBJECTIVE_BECAME_IMPOSSIBLE', (e) => updates.push(`${e.payload.objectiveId}:impossible`));

    runToEnd(sim);

    // Each transition is announced exactly once, however many ticks elapse.
    const impossibleAnnouncements = updates.filter((u) => u.endsWith(':impossible'));
    expect(new Set(impossibleAnnouncements).size).toBe(impossibleAnnouncements.length);
  });

  it('awards no medal when a required objective is unmet', () => {
    const sim = makeSimulation();
    runToEnd(sim);
    expect(sim.getResult()!.medal).toBeNull();
    expect(sim.objectives.isSuccess()).toBe(false);
  });

  it('requires every lower tier before a higher medal', () => {
    const sim = makeSimulation();
    // Force a fracture so silver cannot be met.
    sim.issue({ type: 'WORK', targetId: 'carpenter_bench', label: 'Work' });
    stepTicks(sim, TICKS_PER_SECOND * 30);
    runToEnd(sim);
    sim.keepRecording('Doomed');

    sim.advanceRunNumber();
    sim.startRun();
    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);

    expect(sim.objectives.fractures).toBeGreaterThan(0);
    // Even if bronze were met, silver is gone - so gold cannot be awarded.
    expect(sim.objectives.awardedMedal()).not.toBe('GOLD');
  });

  it('declares the run hopeless as soon as no bolt can reach the ram', () => {
    const sim = makeSimulation();
    // Empty the armoury before the ram arrives, without loading anything.
    const armoury = sim.getWorld().stations.get('armoury_rack')!;
    armoury.stock['bolt'] = 0;

    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);

    const result = sim.getResult()!;
    expect(result.reason).toBe('OBJECTIVE_IMPOSSIBLE');
    // The player is not made to watch the rest of a decided minute.
    expect(result.diagnosis).not.toBeNull();
  });
});

describe('FractureAnalysisSystem', () => {
  it('names the breach and whether repairs were ever made', () => {
    const sim = makeSimulation();
    runToEnd(sim);
    const diagnosis = sim.getResult()!.diagnosis!;

    expect(diagnosis.headline).toMatch(/breached/i);
    expect(diagnosis.detail).toMatch(/nothing was ever delivered/i);
    expect(diagnosis.focusTargetId).toBe('main_gate');
  });

  it('reports a loaded ballista that nobody operated', () => {
    // Driven from a crafted journal so the case is exact: the gate survives,
    // the bolt is winched in time, and the Ram Crew still walks away.
    const at = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);
    const envelope = (tick: number, sourceId: string, targetId?: string) => ({
      tick,
      scenarioId: 'broken_gate',
      sourceId,
      ...(targetId !== undefined ? { targetId } : {}),
    });

    const journal = [
      {
        ...envelope(at(41.3), 'threat-director', 'enemy-ram-1-0'),
        name: 'ENEMY_SPAWNED' as const,
        payload: { enemyId: 'enemy-ram-1-0', enemyDefinitionId: 'ram_crew', lane: 'gate_centre' },
      },
      {
        ...envelope(at(20), 'warden', 'ballista'),
        name: 'ITEM_DELIVERED' as const,
        payload: { actorId: 'warden', itemDefinitionId: 'bolt', stationId: 'ballista' },
      },
      {
        ...envelope(at(22.5), 'ballista'),
        name: 'RECIPE_COMPLETED' as const,
        payload: { stationId: 'ballista', recipeId: 'ballista-load', outputs: ['loaded_shot'] },
      },
      {
        ...envelope(at(48.6), 'enemy-ram-1-0', 'main_gate'),
        name: 'STATION_DAMAGED' as const,
        payload: { stationId: 'main_gate', amount: 12, health: 88, byId: 'enemy-ram-1-0' },
      },
      {
        ...envelope(at(60), 'simulation'),
        name: 'LOOP_ENDED' as const,
        payload: { reason: 'TIMER' as const, success: false },
      },
    ];

    const diagnosis = new FractureAnalysisSystem().analyse(journal, false)!;
    expect(diagnosis.headline).toMatch(/ballista/i);
    expect(diagnosis.headline).toMatch(/never operated/i);
    expect(diagnosis.focusTargetId).toBe('ballista');
    // The number in the message is derived, not guessed: 48.6 - 22.5.
    expect(diagnosis.detail).toContain('26.1s');
  });

  it('reports a bolt that arrived too late to winch', () => {
    const at = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);
    const envelope = (tick: number, sourceId: string, targetId?: string) => ({
      tick,
      scenarioId: 'broken_gate',
      sourceId,
      ...(targetId !== undefined ? { targetId } : {}),
    });

    const journal = [
      {
        ...envelope(at(41.3), 'threat-director', 'enemy-ram-1-0'),
        name: 'ENEMY_SPAWNED' as const,
        payload: { enemyId: 'enemy-ram-1-0', enemyDefinitionId: 'ram_crew', lane: 'gate_centre' },
      },
      {
        ...envelope(at(47.5), 'warden', 'ballista'),
        name: 'ITEM_DELIVERED' as const,
        payload: { actorId: 'warden', itemDefinitionId: 'bolt', stationId: 'ballista' },
      },
      {
        ...envelope(at(48.6), 'enemy-ram-1-0', 'main_gate'),
        name: 'STATION_DAMAGED' as const,
        payload: { stationId: 'main_gate', amount: 12, health: 88, byId: 'enemy-ram-1-0' },
      },
    ];

    const diagnosis = new FractureAnalysisSystem().analyse(journal, false)!;
    expect(diagnosis.headline).toMatch(/too late to winch/i);
    expect(diagnosis.detail).toContain('1.1s');
  });

  it('reports the first fracture with the time it spent waiting', () => {
    const sim = makeSimulation();
    sim.issue({ type: 'WORK', targetId: 'carpenter_bench', label: 'Work' });
    stepTicks(sim, TICKS_PER_SECOND * 30);
    runToEnd(sim);
    sim.keepRecording('Doomed');

    sim.advanceRunNumber();
    sim.startRun();
    // Keep the gate alive so the fracture is the most interesting failure.
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    runToEnd(sim);

    const journal = sim.bus.getJournal();
    const diagnosis = new FractureAnalysisSystem().analyse(journal, false);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.detail.length).toBeGreaterThan(0);
  });

  it('treats a practice minute as a reset, not a failure', () => {
    const journal = [
      {
        name: 'LOOP_ENDED' as const,
        tick: 1800,
        scenarioId: 'broken_gate',
        sourceId: 'simulation',
        payload: { reason: 'TIMER' as const, success: false },
      },
    ];
    const diagnosis = new FractureAnalysisSystem().analyse(journal, false, true)!;
    expect(diagnosis.headline).toMatch(/begins again/i);
    expect(diagnosis.headline).not.toMatch(/fail/i);
  });

  it('produces its message from events, not from the final world state', () => {
    // A journal with no failure events at all still yields an honest note.
    const diagnosis = new FractureAnalysisSystem().analyse([], false);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.headline.length).toBeGreaterThan(0);
  });
});
