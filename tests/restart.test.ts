import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/config/gameConfig';
import { BALLISTA_ROUTE, BROKEN_GATE_SOLUTION, issueAndSettle, makeSimulation, playSequence, runToEnd, stepTicks } from './helpers';

/**
 * The restart regression from design document section 28, run as an automated
 * test rather than a checklist: start the scenario, record commands, end the
 * loop, replay an Echo, fail, restart, complete, and compare the counts that
 * a leak would move.
 */
describe('restart regression', () => {
  it('leaves no growth in actors, reservations or listeners across the full cycle', () => {
    const sim = makeSimulation();

    const census = () => ({
      actors: sim.getWorld().actors.size,
      enemies: sim.getWorld().enemies.size,
      reservations: sim.slots.reservationCount(sim.getWorld()),
      listeners: sim.bus.listenerCount(),
      projectiles: sim.getWorld().projectiles.length,
      telegraphs: sim.getWorld().telegraphs.length,
    });

    // 1-2: start and record at least two commands.
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    issueAndSettle(sim, 'DELIVER', 'carpenter_bench');
    expect(sim.recordedCommandCount).toBeGreaterThanOrEqual(2);

    // 3: end the loop and replay an Echo.
    runToEnd(sim);
    sim.keepRecording('Wood');
    sim.advanceRunNumber();
    sim.startRun();
    const afterFirstReplay = census();
    runToEnd(sim);

    // 4: trigger a failure.
    expect(sim.getResult()!.success).toBe(false);

    // 5: restart, repeatedly.
    for (let i = 0; i < 6; i++) {
      sim.advanceRunNumber();
      sim.startRun();
      runToEnd(sim);
    }

    sim.advanceRunNumber();
    sim.startRun();
    const afterManyReplays = census();

    expect(afterManyReplays.actors).toBe(afterFirstReplay.actors);
    expect(afterManyReplays.listeners).toBe(afterFirstReplay.listeners);
    expect(afterManyReplays.reservations).toBe(0);
    expect(afterManyReplays.enemies).toBe(0);
    expect(afterManyReplays.projectiles).toBe(0);
    expect(afterManyReplays.telegraphs).toBe(0);
  });

  it('resets every mutable part of the world to baseline', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);

    const gateBefore = sim.getWorld().stations.get('main_gate')!.health;
    expect(gateBefore).not.toBe(40); // the run definitely changed something

    sim.advanceRunNumber();
    sim.startRun();
    const world = sim.getWorld();

    expect(world.tick).toBe(0);
    expect(world.stations.get('main_gate')!.health).toBe(40);
    expect(world.stations.get('main_gate')!.destroyed).toBe(false);
    expect(world.stations.get('timber_stack')!.stock['timber']).toBe(2);
    expect(world.stations.get('armoury_rack')!.stock['bolt']).toBe(3);
    expect(world.stations.get('carpenter_bench')!.outputs['plank'] ?? 0).toBe(0);
    expect(world.stations.get('ballista')!.outputs['loaded_shot'] ?? 0).toBe(0);
    expect(sim.getWarden().carrying).toBeNull();
    expect(sim.getWarden().position).toEqual(sim.scenario.wardenSpawn);
    expect(world.enemies.size).toBe(0);
    expect(world.signals).toEqual([]);
    expect(world.firedEventIds.size).toBe(0);
  });

  it('keeps saved tracks across a reset while discarding the live recording', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION.slice(0, 3));
    runToEnd(sim);
    sim.keepRecording('Wood');
    const keptCommands = sim.getTracks()[0]!.commands.length;

    sim.advanceRunNumber();
    sim.startRun();
    // A fresh recording starts empty, but the kept track is untouched.
    expect(sim.recordedCommandCount).toBe(0);
    expect(sim.getTracks()).toHaveLength(1);
    expect(sim.getTracks()[0]!.commands).toHaveLength(keptCommands);
  });

  it('overwrites the chosen slot and leaves the others alone', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION.slice(0, 2));
    runToEnd(sim);
    sim.keepRecording('Wood');

    sim.advanceRunNumber();
    sim.startRun();
    playSequence(sim, BALLISTA_ROUTE);
    runToEnd(sim);
    sim.keepRecording('Bolt');

    sim.advanceRunNumber();
    sim.startRun();
    issueAndSettle(sim, 'SIGNAL', 'hour_bell');
    runToEnd(sim);
    sim.overwriteTrack(0, 'Bell');

    const tracks = sim.getTracks();
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.label).toBe('Bell');
    expect(tracks[0]!.commands[0]!.type).toBe('SIGNAL');
    expect(tracks[1]!.label).toBe('Bolt');
    // Slot indices stay aligned with position, so colours stay stable.
    expect(tracks[0]!.slotIndex).toBe(0);
  });

  it('refuses to exceed the scenario Echo limit', () => {
    const sim = makeSimulation();
    for (let i = 0; i < 8; i++) {
      issueAndSettle(sim, 'TAKE', 'timber_stack');
      runToEnd(sim);
      sim.keepRecording(`Try ${i}`);
      sim.advanceRunNumber();
      sim.startRun();
    }
    expect(sim.getTracks().length).toBeLessThanOrEqual(sim.scenario.maxEchoTracks);
  });

  it('aborting mid-loop settles the run without leaving it half-open', () => {
    const sim = makeSimulation();
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    stepTicks(sim, TICKS_PER_SECOND * 3);

    const result = sim.endRun('ABORTED');
    expect(result.reason).toBe('ABORTED');
    expect(result.success).toBe(false);
    expect(sim.isFinished).toBe(true);
    // Further stepping is a no-op rather than an error.
    stepTicks(sim, 60);
    expect(sim.getResult()).toBe(result);
  });

  it('disposes cleanly, leaving no listeners behind', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION.slice(0, 3));
    runToEnd(sim);

    expect(sim.bus.listenerCount()).toBeGreaterThan(0);
    sim.dispose();
    expect(sim.bus.listenerCount()).toBe(0);
    expect(sim.getWorld().actors.size).toBe(0);
    expect(sim.getWorld().enemies.size).toBe(0);
  });
});
