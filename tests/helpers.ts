import { DEFAULT_SETTINGS } from '../src/config/defaultSettings';
import type { EchoCommandType, PlayerSettings, ScenarioDefinition } from '../src/core/types';
import { BROKEN_GATE } from '../src/data/scenarios/brokenGate';
import { ScenarioSimulation } from '../src/systems/ScenarioSimulation';

export function makeSimulation(
  scenario: ScenarioDefinition = BROKEN_GATE,
  overrides: Partial<PlayerSettings> = {},
  previouslyCompleted = true,
): ScenarioSimulation {
  const sim = new ScenarioSimulation(
    scenario,
    { ...DEFAULT_SETTINGS, ...overrides },
    previouslyCompleted,
  );
  sim.startRun([]);
  return sim;
}

/** Advances `count` ticks, stopping early if the loop ends. */
export function stepTicks(sim: ScenarioSimulation, count: number): void {
  for (let i = 0; i < count && !sim.isFinished; i++) sim.step();
}

/** Runs until the loop ends. */
export function runToEnd(sim: ScenarioSimulation): void {
  let guard = 0;
  while (!sim.isFinished && guard++ < 20000) sim.step();
}

/**
 * Issues a command on the live Warden and steps until it settles.
 * Returns the final task state so a test can assert on it.
 */
export function issueAndSettle(
  sim: ScenarioSimulation,
  type: EchoCommandType,
  targetId?: string,
  point?: { x: number; y: number },
  maxTicks = 900,
): 'COMPLETE' | 'FAILED' | 'TIMEOUT' {
  const resolution = {
    type,
    label: type,
    ...(targetId !== undefined ? { targetId } : {}),
    ...(point !== undefined ? { point } : {}),
  };
  sim.issue(resolution);

  for (let i = 0; i < maxTicks; i++) {
    if (sim.isFinished) break;
    sim.step();
    const task = sim.getWarden().task;
    if (task?.state === 'COMPLETE') return 'COMPLETE';
    if (task?.state === 'FAILED') return 'FAILED';
  }
  return 'TIMEOUT';
}

/**
 * The intended learning solution for The Broken Gate as a scripted sequence.
 * Used to prove the scenario is actually solvable, and as the fixture the
 * batch determinism test replays a hundred times.
 */
export const BROKEN_GATE_SOLUTION: Array<{ type: EchoCommandType; targetId?: string }> = [
  { type: 'TAKE', targetId: 'timber_stack' },
  { type: 'DELIVER', targetId: 'carpenter_bench' },
  { type: 'WORK', targetId: 'carpenter_bench' },
  { type: 'TAKE', targetId: 'carpenter_bench' },
  { type: 'DELIVER', targetId: 'main_gate' },
  { type: 'WORK', targetId: 'main_gate' },
  { type: 'TAKE', targetId: 'carpenter_bench' },
  { type: 'DELIVER', targetId: 'main_gate' },
  { type: 'WORK', targetId: 'main_gate' },
];

/** Second recording: arm the ballista, then hold the bell. */
export const BALLISTA_ROUTE: Array<{ type: EchoCommandType; targetId?: string }> = [
  { type: 'TAKE', targetId: 'armoury_rack' },
  { type: 'DELIVER', targetId: 'ballista' },
];

export function playSequence(
  sim: ScenarioSimulation,
  sequence: Array<{ type: EchoCommandType; targetId?: string }>,
): void {
  for (const step of sequence) {
    if (sim.isFinished) return;
    issueAndSettle(sim, step.type, step.targetId);
  }
}
