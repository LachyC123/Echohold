import { TICKS_PER_SECOND } from '../config/gameConfig';
import type { ScenarioDefinition } from '../core/types';
import { getEnemyDefinition } from './enemies';
import { ITEMS_BY_ID } from './items';
import { isWalkable, worldToCell } from './navGrid';
import { STATIONS_BY_ID } from './stations';

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  message: string;
}

/**
 * Startup validation for development builds (design document section 22).
 *
 * Duplicate IDs, missing references, impossible recipes and unreachable
 * objectives fail loudly here rather than becoming a silent mystery three
 * scenarios later. Adding a scenario should be a data change, and this is what
 * makes a data change safe.
 */
export function validateScenario(scenario: ScenarioDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'ERROR', message });
  const warn = (message: string) => issues.push({ severity: 'WARNING', message });

  // --- Identity ------------------------------------------------------------
  const spawnIds = new Set<string>();
  for (const spawn of scenario.initialEntities) {
    if (spawnIds.has(spawn.id)) error(`Duplicate entity id "${spawn.id}"`);
    spawnIds.add(spawn.id);

    const definition = STATIONS_BY_ID.get(spawn.stationDefinitionId);
    if (!definition) {
      error(`Entity "${spawn.id}" references unknown station "${spawn.stationDefinitionId}"`);
      continue;
    }

    // Every working position has to be standable, or the station is decoration.
    for (const slot of definition.interactionSlots) {
      const point = { x: spawn.position.x + slot.position.x, y: spawn.position.y + slot.position.y };
      const cell = worldToCell(scenario.navGrid, point);
      if (!isWalkable(scenario.navGrid, cell.col, cell.row)) {
        error(`Slot "${spawn.id}.${slot.id}" at ${point.x},${point.y} is not on walkable ground`);
      }
    }

    for (const itemId of Object.keys(spawn.initialStock ?? definition.initialStock ?? {})) {
      if (!ITEMS_BY_ID.has(itemId)) error(`Entity "${spawn.id}" stocks unknown item "${itemId}"`);
    }
  }

  // --- Recipes -------------------------------------------------------------
  const producible = new Set<string>();
  for (const spawn of scenario.initialEntities) {
    const definition = STATIONS_BY_ID.get(spawn.stationDefinitionId);
    if (!definition) continue;
    for (const itemId of Object.keys(spawn.initialStock ?? definition.initialStock ?? {})) {
      producible.add(itemId);
    }
    for (const recipe of definition.recipes) {
      if (recipe.inputs.length > 3) {
        error(`Recipe "${recipe.id}" has ${recipe.inputs.length} inputs; the grammar allows three`);
      }
      if (recipe.workTicks <= 0) error(`Recipe "${recipe.id}" has no duration`);
      if (recipe.outputs.length === 0 && !recipe.repairsTargetId) {
        error(`Recipe "${recipe.id}" produces nothing and repairs nothing`);
      }
      for (const output of recipe.outputs) producible.add(output.itemDefinitionId);
      if (recipe.repairsTargetId && recipe.repairsTargetId !== 'SELF' && !spawnIds.has(recipe.repairsTargetId)) {
        error(`Recipe "${recipe.id}" repairs missing entity "${recipe.repairsTargetId}"`);
      }
    }
  }

  // An input nothing in this scenario can supply is an impossible recipe.
  for (const spawn of scenario.initialEntities) {
    const definition = STATIONS_BY_ID.get(spawn.stationDefinitionId);
    if (!definition) continue;
    for (const recipe of definition.recipes) {
      for (const input of recipe.inputs) {
        if (!producible.has(input.itemDefinitionId)) {
          error(
            `Recipe "${recipe.id}" needs "${input.itemDefinitionId}", which nothing in this scenario produces`,
          );
        }
      }
    }
  }

  // --- Threats -------------------------------------------------------------
  const laneIds = new Set(scenario.lanes.map((lane) => lane.id));
  for (const lane of scenario.lanes) {
    if (!spawnIds.has(lane.targetStationId)) {
      error(`Lane "${lane.id}" attacks missing entity "${lane.targetStationId}"`);
    }
  }

  const eventIds = new Set<string>();
  for (const event of scenario.scheduledEvents) {
    if (eventIds.has(event.id)) error(`Duplicate scheduled event id "${event.id}"`);
    eventIds.add(event.id);

    if (!laneIds.has(event.laneId)) error(`Event "${event.id}" uses unknown lane "${event.laneId}"`);
    if (event.tick < 0 || event.tick > scenario.durationTicks) {
      error(`Event "${event.id}" is scheduled outside the loop`);
    }

    try {
      const enemy = getEnemyDefinition(event.enemyDefinitionId);
      const lane = scenario.lanes.find((l) => l.id === event.laneId);
      if (lane) {
        const distance = Math.hypot(lane.to.x - lane.from.x, lane.to.y - lane.from.y);
        const arrival = event.tick + Math.round((distance / enemy.speed) * TICKS_PER_SECOND);
        if (arrival > scenario.durationTicks) {
          warn(
            `Event "${event.id}" arrives at ${(arrival / TICKS_PER_SECOND).toFixed(1)}s, after the loop ends`,
          );
        }
      }
    } catch {
      error(`Event "${event.id}" references unknown enemy "${event.enemyDefinitionId}"`);
    }
  }

  // --- Objectives ----------------------------------------------------------
  const objectiveIds = new Set<string>();
  let hasRequired = false;
  for (const objective of scenario.objectives) {
    if (objectiveIds.has(objective.id)) error(`Duplicate objective id "${objective.id}"`);
    objectiveIds.add(objective.id);
    if (objective.tier === 'BRONZE') hasRequired = true;

    if (objective.kind === 'STATION_SURVIVES') {
      if (!objective.stationId || !spawnIds.has(objective.stationId)) {
        error(`Objective "${objective.id}" protects missing entity "${objective.stationId}"`);
      }
    }
    if (objective.kind === 'ENEMIES_DEFEATED') {
      const wanted = objective.enemyDefinitionIds ?? [];
      if (wanted.length === 0) error(`Objective "${objective.id}" names no enemies`);
      // An objective to defeat something that never arrives can never be met.
      for (const id of wanted) {
        const scheduled = scenario.scheduledEvents.some((e) => e.enemyDefinitionId === id);
        if (!scheduled) error(`Objective "${objective.id}" requires "${id}", which never spawns`);
      }
    }
    if (objective.kind === 'ECHO_LIMIT') {
      const limit = objective.maxEchoTracks ?? scenario.maxEchoTracks;
      if (limit > scenario.maxEchoTracks) {
        warn(`Objective "${objective.id}" allows more Echoes than the scenario does`);
      }
    }
  }
  if (!hasRequired) error('The scenario has no required (bronze) objective');

  // --- Tutorial ------------------------------------------------------------
  for (const step of scenario.tutorialSteps ?? []) {
    if (step.highlightTargetId && !spawnIds.has(step.highlightTargetId)) {
      error(`Tutorial step "${step.id}" highlights missing entity "${step.highlightTargetId}"`);
    }
    // Two short sentences maximum, enforced rather than hoped for.
    const sentences = step.text.split(/[.!?]/).filter((part) => part.trim().length > 0).length;
    if (sentences > 2) warn(`Tutorial step "${step.id}" has ${sentences} sentences; two is the limit`);
  }

  // --- Reachability --------------------------------------------------------
  const spawnCell = worldToCell(scenario.navGrid, scenario.wardenSpawn);
  if (!isWalkable(scenario.navGrid, spawnCell.col, spawnCell.row)) {
    error('The Warden spawn is not on walkable ground');
  }

  return issues;
}

/**
 * Runs validation and reports it. Errors throw in development so a broken
 * scenario cannot ship quietly; warnings are logged and the game continues.
 */
export function assertScenarioValid(scenario: ScenarioDefinition, throwOnError = true): ValidationIssue[] {
  const issues = validateScenario(scenario);
  const errors = issues.filter((issue) => issue.severity === 'ERROR');
  const warnings = issues.filter((issue) => issue.severity === 'WARNING');

  for (const warning of warnings) {
    console.warn(`[echohold] scenario "${scenario.id}": ${warning.message}`);
  }
  if (errors.length > 0) {
    const summary = errors.map((e) => ` - ${e.message}`).join('\n');
    const message = `Scenario "${scenario.id}" is invalid:\n${summary}`;
    if (throwOnError) throw new Error(message);
    console.error(`[echohold] ${message}`);
  }
  return issues;
}
