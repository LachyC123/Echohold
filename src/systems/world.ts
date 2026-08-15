import type {
  EnemyDefinition,
  RuntimeTask,
  ScenarioDefinition,
  StationDefinition,
  Vec2,
} from '../core/types';
import { getStationDefinition } from '../data/stations';

export type ActorKind = 'WARDEN' | 'ECHO';

export type ActorAnimState =
  | 'IDLE'
  | 'WALK'
  | 'CARRY_IDLE'
  | 'CARRY_WALK'
  | 'TAKE'
  | 'PLACE'
  | 'WORK'
  | 'OPERATE'
  | 'DODGE'
  | 'STAGGER';

export interface SimSlot {
  id: string;
  position: Vec2;
  facing: number;
  /** Reservations, not body collision, decide who may use a station. */
  occupantId: string | null;
}

export interface SimStation {
  id: string;
  definitionId: string;
  position: Vec2;
  slots: SimSlot[];
  /** Inputs delivered and waiting for a recipe. */
  inputs: Record<string, number>;
  /** Finished goods available to TAKE. */
  outputs: Record<string, number>;
  /** SOURCE stock; separate from outputs so a rack can also accept deliveries. */
  stock: Record<string, number>;
  health: number;
  maxHealth: number;
  destroyed: boolean;
  activeRecipeId: string | null;
  workRemainingTicks: number;
  workerId: string | null;
  cooldownUntilTick: number;
  /** Purely presentational: ticks left on a one-shot reaction animation. */
  flashTicks: number;
}

export interface SimActor {
  id: string;
  kind: ActorKind;
  trackId: string | null;
  colourIndex: number;
  label: string | null;
  position: Vec2;
  facing: number;
  baseSpeed: number;
  carrying: string | null;
  path: Vec2[];
  pathIndex: number;
  task: RuntimeTask | null;
  /** Commands not yet eligible or waiting behind the current task. */
  pendingCommandIndex: number;
  fractured: boolean;
  animState: ActorAnimState;
  /** Ticks the current one-shot animation still has to run. */
  animTicks: number;
  dodgeUntilTick: number;
  dodgeCooldownUntilTick: number;
  dodgeVector: Vec2;
  /** Set when a track's critical command fractured; the rest is abandoned. */
  trackAbandoned: boolean;
  /** Ring buffer of recent positions, used to draw the motion trail. */
  trail: Vec2[];
}

export type EnemyState = 'APPROACH' | 'ANTICIPATE' | 'ATTACK' | 'DEAD';

export interface SimEnemy {
  id: string;
  definitionId: string;
  laneId: string;
  position: Vec2;
  targetStationId: string;
  destination: Vec2;
  health: number;
  state: EnemyState;
  nextAttackTick: number;
  stallUntilTick: number;
  spawnTick: number;
  flashTicks: number;
}

export interface SimTelegraph {
  id: string;
  laneId: string;
  enemyDefinitionId: string;
  spawnTick: number;
}

export interface SimProjectile {
  id: string;
  from: Vec2;
  to: Vec2;
  /** 0..1 progress; presentation only, damage is applied on fire. */
  progress: number;
  speed: number;
}

export interface SimSignal {
  signalId: string;
  tick: number;
  byId: string;
}

export interface SimWorld {
  scenarioId: string;
  tick: number;
  runNumber: number;
  actors: Map<string, SimActor>;
  stations: Map<string, SimStation>;
  enemies: Map<string, SimEnemy>;
  telegraphs: SimTelegraph[];
  projectiles: SimProjectile[];
  signals: SimSignal[];
  /** Scheduled events already fired this loop. */
  firedEventIds: Set<string>;
  /** Enemy definition IDs spawned this loop, for objective bookkeeping. */
  spawnedEnemyDefinitionIds: string[];
  defeatedEnemyDefinitionIds: string[];
  finished: boolean;
  quietRun: boolean;
}

/** Absolute world position of a station slot. */
export function slotWorldPosition(station: SimStation, slot: SimSlot): Vec2 {
  return { x: station.position.x + slot.position.x, y: station.position.y + slot.position.y };
}

export function createStation(
  spawnId: string,
  definition: StationDefinition,
  position: Vec2,
  initialHealth?: number,
  initialStock?: Record<string, number>,
): SimStation {
  return {
    id: spawnId,
    definitionId: definition.id,
    position: { ...position },
    slots: definition.interactionSlots.map((slot) => ({
      id: slot.id,
      position: { ...slot.position },
      facing: slot.facing,
      occupantId: null,
    })),
    inputs: {},
    outputs: {},
    stock: { ...(initialStock ?? definition.initialStock ?? {}) },
    health: initialHealth ?? definition.maxHealth,
    maxHealth: definition.maxHealth,
    destroyed: false,
    activeRecipeId: null,
    workRemainingTicks: 0,
    workerId: null,
    cooldownUntilTick: 0,
    flashTicks: 0,
  };
}

export function createActor(
  id: string,
  kind: ActorKind,
  position: Vec2,
  speed: number,
  colourIndex: number,
  trackId: string | null = null,
  label: string | null = null,
): SimActor {
  return {
    id,
    kind,
    trackId,
    colourIndex,
    label,
    position: { ...position },
    facing: 270,
    baseSpeed: speed,
    carrying: null,
    path: [],
    pathIndex: 0,
    task: null,
    pendingCommandIndex: 0,
    fractured: false,
    animState: 'IDLE',
    animTicks: 0,
    dodgeUntilTick: 0,
    dodgeCooldownUntilTick: 0,
    dodgeVector: { x: 0, y: 0 },
    trackAbandoned: false,
    trail: [],
  };
}

export function createEnemy(
  id: string,
  definition: EnemyDefinition,
  laneId: string,
  from: Vec2,
  to: Vec2,
  targetStationId: string,
  spawnTick: number,
): SimEnemy {
  return {
    id,
    definitionId: definition.id,
    laneId,
    position: { ...from },
    destination: { ...to },
    targetStationId,
    health: definition.health,
    state: 'APPROACH',
    nextAttackTick: 0,
    stallUntilTick: 0,
    spawnTick,
    flashTicks: 0,
  };
}

/** Builds the scenario's baseline world. Called on every loop reset. */
export function createBaselineWorld(scenario: ScenarioDefinition, runNumber: number, quietRun: boolean): SimWorld {
  const stations = new Map<string, SimStation>();
  for (const spawn of scenario.initialEntities) {
    const definition = getStationDefinition(spawn.stationDefinitionId);
    stations.set(
      spawn.id,
      createStation(spawn.id, definition, spawn.position, spawn.initialHealth, spawn.initialStock),
    );
  }

  return {
    scenarioId: scenario.id,
    tick: 0,
    runNumber,
    actors: new Map(),
    stations,
    enemies: new Map(),
    telegraphs: [],
    projectiles: [],
    signals: [],
    firedEventIds: new Set(),
    spawnedEnemyDefinitionIds: [],
    defeatedEnemyDefinitionIds: [],
    finished: false,
    quietRun,
  };
}
