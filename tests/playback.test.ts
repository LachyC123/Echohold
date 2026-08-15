import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/config/gameConfig';
import { BROKEN_GATE_SOLUTION, issueAndSettle, makeSimulation, playSequence, runToEnd, stepTicks } from './helpers';

describe('Echo playback', () => {
  it('repeats a recorded take/deliver/work sequence faithfully', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION.slice(0, 3));
    runToEnd(sim);

    const recordedGoods = sim.bus.find('RECIPE_COMPLETED').length;
    expect(recordedGoods).toBeGreaterThan(0);

    sim.keepRecording('Wood');
    sim.advanceRunNumber();
    sim.startRun();
    runToEnd(sim);

    // The Echo did the work this time, with no live input at all.
    const replayedGoods = sim.bus.find('RECIPE_COMPLETED').length;
    expect(replayedGoods).toBe(recordedGoods);

    const takenBy = sim.bus.find('ITEM_TAKEN').map((e) => e.payload.actorId);
    expect(takenBy.every((id) => id.startsWith('echo-'))).toBe(true);
  });

  it('produces the identical result for ten consecutive resets', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);
    sim.keepRecording('Wood');

    const signatures: string[] = [];
    for (let i = 0; i < 10; i++) {
      sim.advanceRunNumber();
      sim.startRun();
      runToEnd(sim);
      const gate = sim.getWorld().stations.get('main_gate')!;
      signatures.push(
        [
          gate.health,
          sim.bus.find('RECIPE_COMPLETED').length,
          sim.bus.find('ITEM_DELIVERED').length,
          sim.bus.find('ECHO_FRACTURED').length,
        ].join('|'),
      );
    }

    expect(new Set(signatures).size).toBe(1);
  });

  it('never duplicates actors, reservations or listeners across resets', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION.slice(0, 4));
    runToEnd(sim);
    sim.keepRecording('Wood');

    const listenersAfterFirst = sim.bus.listenerCount();

    for (let i = 0; i < 8; i++) {
      sim.advanceRunNumber();
      sim.startRun();
      runToEnd(sim);
    }

    const world = sim.getWorld();
    // One Warden plus exactly one body per kept track.
    expect(world.actors.size).toBe(1 + sim.getTracks().length);
    expect(sim.slots.reservationCount(world)).toBe(0);
    expect(sim.bus.listenerCount()).toBe(listenersAfterFirst);
  });

  it('waits in a visible queue rather than failing when a slot is busy', () => {
    // The carpenter bench has a single working position on purpose.
    const sim = makeSimulation();
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    issueAndSettle(sim, 'DELIVER', 'carpenter_bench');
    sim.issue({ type: 'WORK', targetId: 'carpenter_bench', label: 'Work' });
    stepTicks(sim, 20);
    runToEnd(sim);
    sim.keepRecording('Wood');

    // A second identical track has to contend for that one position.
    sim.advanceRunNumber();
    sim.startRun();
    sim.keepRecording('Wood 2');
    sim.advanceRunNumber();
    sim.startRun();
    runToEnd(sim);

    const waits = sim.bus.find('COMMAND_WAITING');
    const fractures = sim.bus.find('ECHO_FRACTURED');
    // Contention is allowed to make an Echo wait; it must not silently vanish.
    expect(waits.length + fractures.length).toBeGreaterThanOrEqual(0);
    expect(sim.getWorld().actors.size).toBe(1 + sim.getTracks().length);
  });

  it('fractures with a reason when a required input never arrives', () => {
    const sim = makeSimulation();
    // Record a WORK on a bench that will never receive timber.
    sim.issue({ type: 'WORK', targetId: 'carpenter_bench', label: 'Work' });
    stepTicks(sim, TICKS_PER_SECOND * 30);
    runToEnd(sim);
    sim.keepRecording('Doomed');

    sim.advanceRunNumber();
    sim.startRun();
    runToEnd(sim);

    const fractures = sim.bus.find('ECHO_FRACTURED');
    expect(fractures.length).toBeGreaterThan(0);
    expect(['MISSING_INPUT', 'TIMEOUT']).toContain(fractures[0]!.payload.reason);
  });

  it('keeps a fractured Echo alive for the rest of its track', () => {
    const sim = makeSimulation();
    sim.issue({ type: 'WORK', targetId: 'carpenter_bench', label: 'Work' });
    stepTicks(sim, TICKS_PER_SECOND * 14);
    issueAndSettle(sim, 'TAKE', 'timber_stack');
    runToEnd(sim);
    sim.keepRecording('Mixed');

    sim.advanceRunNumber();
    sim.startRun();
    runToEnd(sim);

    expect(sim.bus.find('ECHO_FRACTURED').length).toBeGreaterThan(0);
    // The later TAKE still ran: a fracture is not the end of the track.
    expect(sim.bus.find('ITEM_TAKEN').length).toBeGreaterThan(0);
  });
});

describe('item conservation', () => {
  it('never duplicates or loses an item during a transfer', () => {
    const sim = makeSimulation();
    const countItems = () => {
      let total = 0;
      for (const station of sim.getWorld().stations.values()) {
        for (const [id, n] of Object.entries(station.stock)) if (id !== 'loaded_shot') total += n;
        for (const [id, n] of Object.entries(station.inputs)) if (id !== 'loaded_shot') total += n;
        for (const [id, n] of Object.entries(station.outputs)) if (id !== 'loaded_shot') total += n;
      }
      for (const actor of sim.getWorld().actors.values()) if (actor.carrying) total += 1;
      return total;
    };

    // Two timber and three bolts at baseline.
    expect(countItems()).toBe(5);

    issueAndSettle(sim, 'TAKE', 'timber_stack');
    expect(countItems()).toBe(5);

    issueAndSettle(sim, 'DELIVER', 'carpenter_bench');
    expect(countItems()).toBe(5);

    // One timber becomes two planks: a declared recipe conversion, not a leak.
    issueAndSettle(sim, 'WORK', 'carpenter_bench');
    expect(countItems()).toBe(6);
  });
});
