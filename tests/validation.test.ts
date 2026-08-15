import { describe, expect, it } from 'vitest';
import type { ScenarioDefinition } from '../src/core/types';
import { BROKEN_GATE } from '../src/data/scenarios/brokenGate';
import { validateScenario } from '../src/data/validation';

const clone = (): ScenarioDefinition => JSON.parse(JSON.stringify(BROKEN_GATE)) as ScenarioDefinition;
const errors = (scenario: ScenarioDefinition) =>
  validateScenario(scenario).filter((issue) => issue.severity === 'ERROR');

describe('scenario validation', () => {
  it('accepts the shipped scenario without errors', () => {
    const issues = validateScenario(BROKEN_GATE);
    const bad = issues.filter((i) => i.severity === 'ERROR');
    expect(bad, bad.map((i) => i.message).join('\n')).toHaveLength(0);
  });

  it('rejects a duplicate entity id', () => {
    const scenario = clone();
    scenario.initialEntities.push({ ...scenario.initialEntities[0]! });
    expect(errors(scenario).some((e) => e.message.includes('Duplicate entity'))).toBe(true);
  });

  it('rejects an unknown station reference', () => {
    const scenario = clone();
    scenario.initialEntities[0]!.stationDefinitionId = 'no_such_station';
    expect(errors(scenario).some((e) => e.message.includes('unknown station'))).toBe(true);
  });

  it('rejects an objective that requires an enemy which never spawns', () => {
    const scenario = clone();
    scenario.scheduledEvents = scenario.scheduledEvents.filter((e) => e.enemyDefinitionId !== 'ram_crew');
    expect(errors(scenario).some((e) => e.message.includes('never spawns'))).toBe(true);
  });

  it('rejects a lane pointed at a missing structure', () => {
    const scenario = clone();
    scenario.lanes[0]!.targetStationId = 'ghost_gate';
    expect(errors(scenario).some((e) => e.message.includes('missing entity'))).toBe(true);
  });

  it('rejects a scenario with no required objective', () => {
    const scenario = clone();
    scenario.objectives = scenario.objectives.filter((o) => o.tier !== 'BRONZE');
    expect(errors(scenario).some((e) => e.message.includes('no required'))).toBe(true);
  });

  it('rejects a Warden spawn inside a wall', () => {
    const scenario = clone();
    scenario.wardenSpawn = { x: 4, y: 4 };
    expect(errors(scenario).some((e) => e.message.includes('Warden spawn'))).toBe(true);
  });

  it('rejects an interaction slot placed on blocked ground', () => {
    const scenario = clone();
    // Shove the timber stack into the west wall.
    const stack = scenario.initialEntities.find((e) => e.id === 'timber_stack')!;
    stack.position = { x: 8, y: 300 };
    expect(errors(scenario).some((e) => e.message.includes('not on walkable ground'))).toBe(true);
  });

  it('warns about a threat that arrives after the loop ends', () => {
    const scenario = clone();
    scenario.scheduledEvents[0]!.tick = scenario.durationTicks - 5;
    const warnings = validateScenario(scenario).filter((i) => i.severity === 'WARNING');
    expect(warnings.some((w) => w.message.includes('after the loop ends'))).toBe(true);
  });

  it('warns when a tutorial panel runs past two sentences', () => {
    const scenario = clone();
    scenario.tutorialSteps![0]!.text = 'One. Two. Three.';
    const warnings = validateScenario(scenario).filter((i) => i.severity === 'WARNING');
    expect(warnings.some((w) => w.message.includes('two is the limit'))).toBe(true);
  });
});
