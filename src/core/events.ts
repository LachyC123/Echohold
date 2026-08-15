import type { EchoCommandType, MedalTier, TaskFailureReason } from './types';

/**
 * The shared domain event vocabulary (design document section 23).
 *
 * Rules emit these; presentation subscribes to them. Animations and particles
 * must never award a resource or complete a task - they only react. The
 * Fracture Analysis system consumes exactly the same stream the objectives do,
 * which is what guarantees a review message can never contradict the rules.
 */

export interface EventEnvelope {
  /** Simulation tick the event was emitted on. */
  tick: number;
  scenarioId: string;
  /** Entity that caused the event (actor, station, enemy, system). */
  sourceId: string;
  targetId?: string;
}

export interface DomainEventPayloads {
  LOOP_STARTED: { runNumber: number; echoCount: number };
  LOOP_TICK_WARNING: { remainingSeconds: number };
  LOOP_ENDED: { reason: 'TIMER' | 'OBJECTIVE_IMPOSSIBLE' | 'ABORTED'; success: boolean };

  COMMAND_ISSUED: { commandId: string; type: EchoCommandType; actorId: string };
  COMMAND_STARTED: { commandId: string; type: EchoCommandType; actorId: string };
  COMMAND_WAITING: { commandId: string; actorId: string; reason: TaskFailureReason };
  COMMAND_COMPLETED: { commandId: string; type: EchoCommandType; actorId: string };
  COMMAND_FAILED: { commandId: string; actorId: string; reason: TaskFailureReason };

  ACTOR_MOVED: { actorId: string; x: number; y: number };
  ITEM_TAKEN: { actorId: string; itemDefinitionId: string };
  ITEM_DELIVERED: { actorId: string; itemDefinitionId: string; stationId: string };

  RECIPE_STARTED: { stationId: string; recipeId: string };
  RECIPE_COMPLETED: { stationId: string; recipeId: string; outputs: string[] };

  STATION_DAMAGED: { stationId: string; amount: number; health: number; byId: string };
  STATION_REPAIRED: { stationId: string; amount: number; health: number };
  STATION_DESTROYED: { stationId: string };

  SIGNAL_EMITTED: { signalId: string; byId: string };
  ENEMY_SPAWNED: { enemyId: string; enemyDefinitionId: string; lane: string };
  ENEMY_DEFEATED: { enemyId: string; enemyDefinitionId: string; byId: string };
  THREAT_TELEGRAPHED: { enemyDefinitionId: string; lane: string; arrivesInSeconds: number };
  ECHO_FRACTURED: { actorId: string; trackId: string; commandId: string; reason: TaskFailureReason };

  OBJECTIVE_UPDATED: { objectiveId: string; complete: boolean; progressText: string };
  OBJECTIVE_BECAME_IMPOSSIBLE: { objectiveId: string; reason: string };
  SCENARIO_STABILISED: { medal: MedalTier; echoCount: number };
  REWARD_GRANTED: { rewardId: string; kind: string };

  SAVE_SUCCEEDED: { schemaVersion: number };
  SAVE_FAILED: { message: string };
}

export type DomainEventName = keyof DomainEventPayloads;

export type DomainEvent<K extends DomainEventName = DomainEventName> = {
  [N in K]: EventEnvelope & { name: N; payload: DomainEventPayloads[N] };
}[K];

/**
 * Narrows a journal to one event name.
 *
 * TypeScript cannot prove that a member of the full union is a member of the
 * single-key union without a predicate, so the cast is made once, here, rather
 * than at every call site that reads a payload.
 */
export function selectEvents<K extends DomainEventName>(
  journal: readonly DomainEvent[],
  name: K,
): DomainEvent<K>[] {
  return journal.filter((event) => event.name === name) as DomainEvent<K>[];
}

/** First matching event, or undefined. */
export function firstEvent<K extends DomainEventName>(
  journal: readonly DomainEvent[],
  name: K,
): DomainEvent<K> | undefined {
  return journal.find((event) => event.name === name) as DomainEvent<K> | undefined;
}

export const DOMAIN_EVENT_NAMES = [
  'LOOP_STARTED',
  'LOOP_TICK_WARNING',
  'LOOP_ENDED',
  'COMMAND_ISSUED',
  'COMMAND_STARTED',
  'COMMAND_WAITING',
  'COMMAND_COMPLETED',
  'COMMAND_FAILED',
  'ACTOR_MOVED',
  'ITEM_TAKEN',
  'ITEM_DELIVERED',
  'RECIPE_STARTED',
  'RECIPE_COMPLETED',
  'STATION_DAMAGED',
  'STATION_REPAIRED',
  'STATION_DESTROYED',
  'SIGNAL_EMITTED',
  'ENEMY_SPAWNED',
  'ENEMY_DEFEATED',
  'THREAT_TELEGRAPHED',
  'ECHO_FRACTURED',
  'OBJECTIVE_UPDATED',
  'OBJECTIVE_BECAME_IMPOSSIBLE',
  'SCENARIO_STABILISED',
  'REWARD_GRANTED',
  'SAVE_SUCCEEDED',
  'SAVE_FAILED',
] as const satisfies readonly DomainEventName[];
