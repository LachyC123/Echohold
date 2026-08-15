/**
 * Core runtime and data types (design document sections 7.2 and 22).
 *
 * Everything addressable uses a stable string ID. Recordings reference those
 * IDs rather than raw coordinates, which is what lets an Echo re-path to the
 * carpenter bench when the world differs slightly from the run it was recorded
 * in.
 */

// ---------------------------------------------------------------------------
// Recording model
// ---------------------------------------------------------------------------

export type EchoCommandType =
  | 'MOVE_TO'
  | 'TAKE'
  | 'DELIVER'
  | 'WORK'
  | 'OPERATE'
  | 'WAIT'
  | 'SIGNAL'
  | 'DODGE';

export type CommandFallback = 'WAIT' | 'SKIP' | 'RETRY_UNTIL_TIMEOUT';

export interface PathSample {
  tick: number;
  x: number;
  y: number;
}

export interface EchoCommand {
  id: string;
  type: EchoCommandType;
  issuedTick: number;
  targetId?: string;
  itemDefinitionId?: string;
  requestedDurationTicks?: number;
  fallback: CommandFallback;
  timeoutTicks: number;
  /**
   * Optional visual record of how the player actually moved. Playback prefers
   * pathfinding to the stable target; samples only shape the drawn route.
   */
  pathSamples?: PathSample[];
  /** A critical command stops the rest of the track when it fractures. */
  critical?: boolean;
  /**
   * Set only when the player interrupted this command by tapping something
   * else. Playback cancels the command after the same elapsed time, so an
   * Echo reproduces "walked halfway, changed my mind" instead of stubbornly
   * finishing a journey the player abandoned.
   */
  maxRunTicks?: number;
  /** Free position for MOVE_TO commands aimed at open ground. */
  point?: { x: number; y: number };
}

export interface EchoTrack {
  id: string;
  scenarioId: string;
  slotIndex: number;
  colourIndex: number;
  commands: EchoCommand[];
  durationTicks: number;
  createdAtRunNumber: number;
  /** Short player-authored role label such as "Wood" or "Ballista". */
  label?: string;
  /** Recall ability: whole-track offset in ticks, clamped to +/- 3 seconds. */
  offsetTicks?: number;
}

// ---------------------------------------------------------------------------
// Task runtime
// ---------------------------------------------------------------------------

export type TaskState = 'QUEUED' | 'MOVING' | 'WAITING' | 'ACTIVE' | 'COMPLETE' | 'FAILED';

export type TaskFailureReason =
  | 'TARGET_MISSING'
  | 'TARGET_DESTROYED'
  | 'UNREACHABLE'
  | 'SLOT_BUSY'
  | 'MISSING_INPUT'
  | 'HANDS_FULL'
  | 'HANDS_EMPTY'
  | 'WRONG_ITEM'
  | 'STORAGE_FULL'
  | 'NOT_READY'
  | 'INTERRUPTED'
  | 'TIMEOUT'
  | 'LOOP_ENDED';

export interface RuntimeTask {
  id: string;
  actorId: string;
  targetId: string;
  type: EchoCommandType;
  state: TaskState;
  issuedTick: number;
  startedTick?: number;
  completedTick?: number;
  failureReason?: TaskFailureReason;
  /** Events this task waited on; the review turns these into plain language. */
  dependencyEventIds: string[];
  /** Ticks spent in WAITING, surfaced as hatching on the timeline strip. */
  waitedTicks: number;
  reservedSlotId?: string;
  workRemainingTicks?: number;
  commandId: string;
}

// ---------------------------------------------------------------------------
// World definitions
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export interface InteractionSlotDefinition {
  id: string;
  /** Where the actor stands while working. */
  position: Vec2;
  /** Facing in degrees, used to orient the work animation. */
  facing: number;
}

export interface RecipeDefinition {
  id: string;
  /** At most three inputs (design document section 10). */
  inputs: Array<{ itemDefinitionId: string; count: number }>;
  outputs: Array<{ itemDefinitionId: string; count: number }>;
  workTicks: number;
  /** Repair recipes convert work into structure health instead of an item. */
  repairsTargetId?: string;
  repairAmount?: number;
  /** Automatically starts as soon as inputs are present, without a WORK tap. */
  autoStart?: boolean;
}

export type StationKind =
  | 'SOURCE'
  | 'CRAFT'
  | 'REPAIR'
  | 'DEFENCE'
  | 'SIGNAL'
  | 'STRUCTURE'
  | 'STOCKPILE';

export interface StationDefinition {
  id: string;
  displayName: string;
  kind: StationKind;
  textureKey: string;
  interactionSlots: InteractionSlotDefinition[];
  acceptedItemTags: string[];
  recipes: RecipeDefinition[];
  maxHealth: number;
  stateVisualKeys: Record<string, string>;
  /** Stock a SOURCE station dispenses; undefined means unlimited. */
  initialStock?: Record<string, number>;
  /** Seconds to take an item from a SOURCE station. */
  takeTicks?: number;
  /** Grid footprint in cells, used to block navigation. */
  footprint?: { width: number; height: number };
}

export interface ItemDefinition {
  id: string;
  displayName: string;
  tags: string[];
  textureKey: string;
  /** Heavy items may later slow the carrier; light items stack in a satchel. */
  weight: 'LIGHT' | 'STANDARD';
}

export type EnemyBehaviour = 'RAIDER' | 'TORCHBEARER' | 'RAM_CREW' | 'CLIMBER' | 'SABOTEUR';

export interface EnemyDefinition {
  id: string;
  displayName: string;
  behaviour: EnemyBehaviour;
  textureKey: string;
  health: number;
  /** World units per second. */
  speed: number;
  damage: number;
  attackIntervalTicks: number;
  /** Weak raiders are the ones the Hour Bell can stall. */
  stallable: boolean;
  /** Ticks of anticipation before the first blow lands. */
  anticipationTicks: number;
}

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

export interface SpawnDefinition {
  id: string;
  stationDefinitionId: string;
  position: Vec2;
  /** Overrides for this placement, e.g. a gate that starts damaged. */
  initialHealth?: number;
  initialStock?: Record<string, number>;
}

export interface ScheduledScenarioEvent {
  id: string;
  tick: number;
  kind: 'SPAWN_ENEMY' | 'TELEGRAPH';
  enemyDefinitionId: string;
  laneId: string;
}

export interface LaneDefinition {
  id: string;
  /** Straight, readable approach: spawn point through to the attack position. */
  from: Vec2;
  to: Vec2;
  /** Station the lane's enemies attack when they arrive. */
  targetStationId: string;
}

export type ObjectiveKind =
  | 'STATION_SURVIVES'
  | 'ENEMIES_DEFEATED'
  | 'NO_FRACTURES'
  | 'ECHO_LIMIT'
  | 'FIRES_EXTINGUISHED';

export interface ObjectiveDefinition {
  id: string;
  tier: MedalTier;
  kind: ObjectiveKind;
  description: string;
  stationId?: string;
  enemyDefinitionIds?: string[];
  maxEchoTracks?: number;
}

export type MedalTier = 'BRONZE' | 'SILVER' | 'GOLD';

export interface RewardDefinition {
  id: string;
  kind: 'STABILITY' | 'MEMORY_SHARDS' | 'UPGRADE_CHOICE' | 'HUB_RESTORATION' | 'RELIC_CHOICE';
  amount?: number;
  /** Hub section restored, or the upgrade IDs offered as a choice. */
  targetId?: string;
  optionIds?: string[];
  requiresMedal?: MedalTier;
}

export interface TutorialStep {
  id: string;
  /** Shown until the condition is met. Two short sentences maximum. */
  text: string;
  /** Pauses the loop timer while a mandatory first-use instruction is up. */
  pausesTimer: boolean;
  highlightTargetId?: string;
  /** Run number this step belongs to (0-indexed). */
  runNumber: number;
  completeOn:
    | { kind: 'MOVE_ANYWHERE' }
    | { kind: 'ITEM_TAKEN'; itemDefinitionId: string }
    | { kind: 'ITEM_DELIVERED'; stationId: string }
    | { kind: 'RECIPE_COMPLETED'; stationId: string }
    | { kind: 'SIGNAL_EMITTED' }
    | { kind: 'LOOP_ENDED' }
    | { kind: 'ACKNOWLEDGED' };
}

export interface NavGridDefinition {
  cellSize: number;
  width: number;
  height: number;
  /** Row-major walkability. `1` walkable, `0` blocked. */
  cells: number[];
}

export interface ScenarioDefinition {
  id: string;
  chapterId: string;
  title: string;
  /** One or two evocative lines shown on the brief screen. */
  brief: string;
  durationTicks: number;
  maxEchoTracks: number;
  mapKey: string;
  seed: number;
  worldSize: Vec2;
  wardenSpawn: Vec2;
  navGrid: NavGridDefinition;
  /**
   * Masonry to paint, in world units. Deliberately separate from the
   * navigation blockers: a station body blocks movement but must not be drawn
   * as a wall, or every bench sits on a slab of stone.
   */
  wallRects: Array<{ x: number; y: number; width: number; height: number }>;
  initialEntities: SpawnDefinition[];
  lanes: LaneDefinition[];
  scheduledEvents: ScheduledScenarioEvent[];
  objectives: ObjectiveDefinition[];
  rewards: RewardDefinition[];
  tutorialSteps?: TutorialStep[];
  /**
   * Number of opening runs that stay free of threats while the tutorial
   * teaches the verbs. Ignored once the scenario has been completed once, so
   * a replay is always the real scenario.
   */
  tutorialQuietRuns?: number;
}

// ---------------------------------------------------------------------------
// Save data
// ---------------------------------------------------------------------------

export interface PlayerSettings {
  musicVolume: number;
  effectsVolume: number;
  hapticsEnabled: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  largeText: boolean;
  /** Difficulty assists (design document section 16). */
  slowSimulation: boolean;
  earlyThreatMarkers: boolean;
  extendedTimeouts: boolean;
  autoPauseOnFracture: boolean;
  quality: 'LOW' | 'HIGH' | 'AUTO';
  controlScheme: 'TAP_TO_COMMAND' | 'DIRECT';
}

export interface ResidentSaveState {
  id: string;
  rescued: boolean;
  storyBeatsSeen: string[];
}

export interface SaveDataV1 {
  schemaVersion: 1;
  createdAtIso: string;
  updatedAtIso: string;
  completedScenarioIds: string[];
  medalByScenarioId: Record<string, MedalTier>;
  memoryShards: number;
  stability: number;
  unlockedUpgradeIds: string[];
  equippedRelicSetId?: string;
  discoveredRelicIds: string[];
  residentStates: Record<string, ResidentSaveState>;
  restoredHubSectionIds: string[];
  settings: PlayerSettings;
  /** Optional saved solution tracks for completed scenarios. */
  savedTracksByScenarioId?: Record<string, EchoTrack[]>;
}

export const CURRENT_SAVE_VERSION = 1 as const;
