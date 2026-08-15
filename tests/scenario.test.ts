import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../src/config/gameConfig';
import { BROKEN_GATE } from '../src/data/scenarios/brokenGate';
import { BALLISTA_ROUTE, BROKEN_GATE_SOLUTION, issueAndSettle, makeSimulation, playSequence, runToEnd, stepTicks } from './helpers';

describe('The Broken Gate baseline', () => {
  it('starts the gate damaged at 40 of 100', () => {
    const sim = makeSimulation();
    const gate = sim.getWorld().stations.get('main_gate')!;
    expect(gate.health).toBe(40);
    expect(gate.maxHealth).toBe(100);
  });

  it('delivers the raiders at 39s and the ram at 48s, as the brief promises', () => {
    // The gate has to survive for the ram to be observed arriving at all, so
    // this runs the repair route rather than standing still.
    const sim = makeSimulation();
    const arrivals = new Map<string, number>();

    playSequence(sim, BROKEN_GATE_SOLUTION);
    while (!sim.isFinished) {
      sim.step();
      for (const enemy of sim.getWorld().enemies.values()) {
        if (arrivals.has(enemy.id)) continue;
        if (enemy.state !== 'APPROACH') {
          arrivals.set(enemy.id, sim.getWorld().tick / TICKS_PER_SECOND);
        }
      }
    }

    const seconds = [...arrivals.entries()];
    const raiders = seconds.filter(([id]) => id.includes('raid')).map(([, s]) => s);
    const ram = seconds.find(([id]) => id.includes('ram'))?.[1];

    expect(raiders).toHaveLength(2);
    for (const second of raiders) expect(second).toBeCloseTo(39, 0);
    expect(ram).toBeDefined();
    expect(ram!).toBeCloseTo(48, 0);
  });

  it('is unwinnable by standing still, which is what forces the first loop', () => {
    const sim = makeSimulation();
    runToEnd(sim);
    const result = sim.getResult()!;
    expect(result.success).toBe(false);
    expect(sim.getWorld().stations.get('main_gate')!.destroyed).toBe(true);
  });

  it('is still unwinnable by repairing alone, which is what forces the second Echo', () => {
    const sim = makeSimulation();
    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);

    const result = sim.getResult()!;
    expect(result.success).toBe(false);
    // The repairs must have actually landed - otherwise this proves nothing.
    const repairs = sim.bus.find('STATION_REPAIRED');
    expect(repairs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('The Broken Gate intended solution', () => {
  it('is winnable with two Echoes and a live Warden', () => {
    const sim = makeSimulation();

    // Run 1: the carpentry route.
    playSequence(sim, BROKEN_GATE_SOLUTION);
    runToEnd(sim);
    sim.keepRecording('Wood');
    sim.advanceRunNumber();

    // Run 2: arm the ballista while Echo one repeats the carpentry.
    sim.startRun();
    playSequence(sim, BALLISTA_ROUTE);
    runToEnd(sim);
    sim.keepRecording('Bolt');
    sim.advanceRunNumber();

    // Run 3: both Echoes work; the Warden rings the bell and fires.
    sim.startRun();
    stepTicks(sim, TICKS_PER_SECOND * 36);
    issueAndSettle(sim, 'SIGNAL', 'hour_bell');
    stepTicks(sim, TICKS_PER_SECOND * 10);
    issueAndSettle(sim, 'OPERATE', 'ballista');
    runToEnd(sim);

    const result = sim.getResult()!;
    const gate = sim.getWorld().stations.get('main_gate')!;

    expect(result.success).toBe(true);
    expect(result.medal).not.toBeNull();
    expect(gate.destroyed).toBe(false);
    expect(gate.health).toBeGreaterThan(0);
  });
});

describe('objective impossibility', () => {
  it('ends the loop early rather than making the player watch a lost minute', () => {
    const sim = makeSimulation();
    runToEnd(sim);
    const result = sim.getResult()!;
    expect(result.reason).toBe('OBJECTIVE_IMPOSSIBLE');
    expect(result.diagnosis).not.toBeNull();
  });

  it('names the first broken dependency in plain language', () => {
    const sim = makeSimulation();
    runToEnd(sim);
    const diagnosis = sim.getResult()!.diagnosis!;
    expect(diagnosis.headline.length).toBeGreaterThan(0);
    expect(diagnosis.detail.length).toBeGreaterThan(0);
    expect(diagnosis.tick).toBeGreaterThan(0);
  });
});

describe('scenario definition integrity', () => {
  it('places every interaction slot on walkable ground', () => {
    const sim = makeSimulation();
    for (const station of sim.getWorld().stations.values()) {
      for (const slot of station.slots) {
        const point = {
          x: station.position.x + slot.position.x,
          y: station.position.y + slot.position.y,
        };
        expect(
          sim.nav.isPointWalkable(point),
          `${station.id}.${slot.id} at ${point.x},${point.y} is not walkable`,
        ).toBe(true);
      }
    }
  });

  it('can path from the Warden spawn to every station', () => {
    const sim = makeSimulation();
    for (const station of sim.getWorld().stations.values()) {
      const slot = station.slots[0]!;
      const target = {
        x: station.position.x + slot.position.x,
        y: station.position.y + slot.position.y,
      };
      const path = sim.nav.findPath(BROKEN_GATE.wardenSpawn, target);
      expect(path, `no route to ${station.id}`).not.toBeNull();
    }
  });
});
