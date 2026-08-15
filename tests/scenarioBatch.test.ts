import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/config/defaultSettings';
import { FixedStepClock } from '../src/core/FixedStepClock';
import { SeededRng } from '../src/core/SeededRng';
import { BROKEN_GATE } from '../src/data/scenarios/brokenGate';
import { ScenarioSimulation } from '../src/systems/ScenarioSimulation';
import { BALLISTA_ROUTE, BROKEN_GATE_SOLUTION, issueAndSettle, makeSimulation, playSequence, runToEnd } from './helpers';

/**
 * Scenario batch validation (design document section 24): at least a hundred
 * automated replays of a known scripted solution, across different render
 * frame patterns. The logical result must be byte-identical every time.
 */

/** A compact fingerprint of everything the rules decided during a loop. */
function signature(sim: ScenarioSimulation): string {
  const journal = sim.bus
    .getJournal()
    .map((e) => `${e.tick}:${e.name}:${e.sourceId}:${e.targetId ?? '-'}`)
    .join('\n');
  const world = sim.getWorld();
  const stations = Array.from(world.stations.values())
    .map((s) => `${s.id}=${s.health}/${JSON.stringify(s.stock)}/${JSON.stringify(s.outputs)}`)
    .join(';');
  return `${journal}\n--\n${stations}\n--\n${sim.getResult()?.medal ?? 'none'}`;
}

/** Builds the two-Echo solution, then replays it once and fingerprints it. */
function buildSolvedSimulation(): ScenarioSimulation {
  const sim = makeSimulation();
  playSequence(sim, BROKEN_GATE_SOLUTION);
  runToEnd(sim);
  sim.keepRecording('Wood');
  sim.advanceRunNumber();

  sim.startRun();
  playSequence(sim, BALLISTA_ROUTE);
  runToEnd(sim);
  sim.keepRecording('Bolt');
  sim.advanceRunNumber();
  return sim;
}

describe('scenario batch validation', () => {
  it('produces an identical journal across 100 replays', () => {
    const sim = buildSolvedSimulation();

    const signatures = new Set<string>();
    for (let run = 0; run < 100; run++) {
      sim.startRun();
      runToEnd(sim);
      signatures.add(signature(sim));
      sim.advanceRunNumber();
    }

    expect(signatures.size).toBe(1);
  });

  it('is unaffected by the frame pattern the renderer happens to use', () => {
    // 30 FPS, 60 FPS, 120 FPS, and a deliberately erratic pattern including a
    // tab-restore-sized stall that must be clamped rather than replayed.
    const patterns: Array<{ name: string; deltas: number[] }> = [
      { name: '30fps', deltas: [33.333] },
      { name: '60fps', deltas: [16.667] },
      { name: '120fps', deltas: [8.333] },
      { name: 'erratic', deltas: [16.7, 33.4, 8.3, 50.1, 16.7, 12.0, 41.2] },
      { name: 'stall', deltas: [16.7, 16.7, 16.7, 4000, 16.7, 16.7] },
    ];

    const reference = buildSolvedSimulation();
    reference.startRun();
    runToEnd(reference);
    const expected = signature(reference);

    for (const pattern of patterns) {
      const sim = buildSolvedSimulation();
      sim.startRun();

      // Drive the simulation through the real fixed-step clock rather than
      // calling step() directly, so the accumulator is part of the test.
      const clock = new FixedStepClock();
      let index = 0;
      let guard = 0;
      while (!sim.isFinished && guard++ < 20000) {
        const delta = pattern.deltas[index % pattern.deltas.length]!;
        index += 1;
        clock.advance(delta, () => sim.step());
      }

      expect(sim.isFinished, `${pattern.name} never finished`).toBe(true);
      expect(signature(sim), `${pattern.name} diverged`).toBe(expected);
    }
  });

  it('gives two independent simulations the same result from the same input', () => {
    const a = buildSolvedSimulation();
    const b = buildSolvedSimulation();
    a.startRun();
    b.startRun();
    runToEnd(a);
    runToEnd(b);
    expect(signature(a)).toBe(signature(b));
  });

  it('schedules threats deterministically from the seed', () => {
    const arrivals: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sim = new ScenarioSimulation(BROKEN_GATE, { ...DEFAULT_SETTINGS }, true);
      sim.startRun([]);
      runToEnd(sim);
      arrivals.push(
        sim.bus
          .find('ENEMY_SPAWNED')
          .map((e) => `${e.tick}:${e.payload.enemyDefinitionId}:${e.payload.lane}`)
          .join(','),
      );
    }
    expect(new Set(arrivals).size).toBe(1);
    expect(arrivals[0]).toContain('raider');
    expect(arrivals[0]).toContain('ram_crew');
  });

  it('never consults Math.random inside the rules', () => {
    const original = Math.random;
    let called = 0;
    Math.random = () => {
      called += 1;
      return original();
    };
    try {
      const sim = makeSimulation();
      issueAndSettle(sim, 'TAKE', 'timber_stack');
      runToEnd(sim);
      sim.keepRecording('Wood');
      sim.advanceRunNumber();
      sim.startRun();
      runToEnd(sim);
    } finally {
      Math.random = original;
    }
    expect(called).toBe(0);
  });
});

describe('SeededRng', () => {
  it('is reproducible for a given seed', () => {
    const a = new SeededRng(1234);
    const b = new SeededRng(1234);
    const left = Array.from({ length: 20 }, () => a.next());
    const right = Array.from({ length: 20 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 10 }, (_, i) => new SeededRng(i).next());
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('stays in range and survives a zero seed', () => {
    const rng = new SeededRng(0);
    for (let i = 0; i < 500; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(rng.nextInt(5, 5)).toBe(5);
    expect(rng.pick([])).toBeUndefined();
  });

  it('restores an exact stream position from a snapshot', () => {
    const rng = new SeededRng(99);
    rng.next();
    const state = rng.getState();
    const expected = [rng.next(), rng.next()];
    rng.setState(state);
    expect([rng.next(), rng.next()]).toEqual(expected);
  });
});

describe('FixedStepClock', () => {
  it('emits exactly one tick per fixed step regardless of frame size', () => {
    const clock = new FixedStepClock();
    let ticks = 0;
    // One second of wall time at 60 FPS is 30 ticks at 30 ticks per second.
    for (let i = 0; i < 60; i++) clock.advance(16.667, () => ticks++);
    expect(ticks).toBe(30);
  });

  it('clamps a tab-restore stall instead of replaying it', () => {
    const clock = new FixedStepClock();
    let ticks = 0;
    clock.advance(40000, () => ticks++);
    // 250ms of clamped delta is at most 8 ticks, not 1200.
    expect(ticks).toBeLessThanOrEqual(8);
  });

  it('emits nothing while paused and does not burst on resume', () => {
    const clock = new FixedStepClock();
    let ticks = 0;
    clock.advance(20, () => ticks++);
    clock.setPaused(true);
    for (let i = 0; i < 30; i++) clock.advance(16.667, () => ticks++);
    const whilePaused = ticks;
    clock.setPaused(false);
    clock.advance(16.667, () => ticks++);
    expect(ticks - whilePaused).toBeLessThanOrEqual(1);
  });
});
