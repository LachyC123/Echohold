import type { ScenarioDefinition } from '../../core/types';
import { BROKEN_GATE } from './brokenGate';

/**
 * Every scenario the build ships. Adding one here is all a new scenario needs
 * to be validated at startup and offered by the hub.
 */
export const ALL_SCENARIOS: ScenarioDefinition[] = [BROKEN_GATE];

export const SCENARIOS_BY_ID = new Map(ALL_SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS_BY_ID.get(id);
}

export { BROKEN_GATE };
