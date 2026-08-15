import { LOOP_TICKS, TICKS_PER_SECOND } from '../../config/gameConfig';
import type { ScenarioDefinition } from '../../core/types';
import { buildNavGrid, type Rect } from '../navGrid';

const WORLD = { x: 480, y: 792 };

const t = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);

/**
 * Structural blockers are authored before decoration (design document section
 * 13). The Hour Bell sits in the middle of the courtyard specifically so that
 * every route around it is a loop and no single corridor becomes a choke
 * point.
 */
const WALLS: Rect[] = [
  // Curtain wall.
  { x: 0, y: 0, width: WORLD.x, height: 96 },
  { x: 0, y: 0, width: 48, height: WORLD.y },
  { x: WORLD.x - 48, y: 0, width: 48, height: WORLD.y },
  { x: 0, y: WORLD.y - 48, width: WORLD.x, height: 48 },
];

/**
 * Station bodies. Actors path around these and stand at the authored slots,
 * but they are drawn as their own furniture rather than as masonry.
 */
const STATION_FOOTPRINTS: Rect[] = [
  { x: 72, y: 276, width: 48, height: 48 }, // timber stack
  { x: 72, y: 444, width: 48, height: 48 }, // carpenter bench
  { x: 360, y: 276, width: 48, height: 48 }, // armoury rack
  { x: 360, y: 144, width: 48, height: 48 }, // ballista platform
  { x: 204, y: 384, width: 72, height: 72 }, // Hour Bell plinth
];

const BLOCKERS: Rect[] = [...WALLS, ...STATION_FOOTPRINTS];

/**
 * Chapter 1, scenario 1: The Broken Gate (design document section 12).
 *
 * Baseline: gate at 40/100, two loose timber bundles, bolts on the rack.
 * Two Raiders reach the gate at 39s; the Ram Crew reaches it at 48s.
 */
export const BROKEN_GATE: ScenarioDefinition = {
  id: 'broken_gate',
  chapterId: 'emberwatch',
  title: 'The Broken Gate',
  brief: 'The gate held for fifty-nine seconds. Learn what the sixtieth needs.',
  durationTicks: LOOP_TICKS,
  maxEchoTracks: 4,
  mapKey: 'emberwatch_courtyard',
  seed: 0x4b17,
  worldSize: WORLD,
  wardenSpawn: { x: 240, y: 660 },
  navGrid: buildNavGrid(WORLD, BLOCKERS),
  wallRects: WALLS,
  tutorialQuietRuns: 2,

  initialEntities: [
    { id: 'main_gate', stationDefinitionId: 'main_gate', position: { x: 240, y: 96 }, initialHealth: 40 },
    {
      id: 'timber_stack',
      stationDefinitionId: 'timber_stack',
      position: { x: 96, y: 300 },
      initialStock: { timber: 2 },
    },
    { id: 'carpenter_bench', stationDefinitionId: 'carpenter_bench', position: { x: 96, y: 468 } },
    {
      id: 'armoury_rack',
      stationDefinitionId: 'armoury_rack',
      position: { x: 384, y: 300 },
      initialStock: { bolt: 3 },
    },
    { id: 'ballista', stationDefinitionId: 'ballista', position: { x: 384, y: 168 } },
    { id: 'hour_bell', stationDefinitionId: 'hour_bell', position: { x: 240, y: 420 } },
  ],

  lanes: [
    { id: 'gate_west', from: { x: 206, y: -60 }, to: { x: 206, y: 150 }, targetStationId: 'main_gate' },
    { id: 'gate_east', from: { x: 274, y: -60 }, to: { x: 274, y: 150 }, targetStationId: 'main_gate' },
    { id: 'gate_centre', from: { x: 240, y: -80 }, to: { x: 240, y: 156 }, targetStationId: 'main_gate' },
  ],

  // Spawn ticks are derived from lane length and speed so that arrival lands
  // exactly on the times the brief promises. Change a speed in balance.ts and
  // the validator will report the drift.
  scheduledEvents: [
    { id: 'raid-1', tick: t(35.5), kind: 'SPAWN_ENEMY', enemyDefinitionId: 'raider', laneId: 'gate_west' },
    { id: 'raid-2', tick: t(35.5), kind: 'SPAWN_ENEMY', enemyDefinitionId: 'raider', laneId: 'gate_east' },
    { id: 'ram-1', tick: t(41.27), kind: 'SPAWN_ENEMY', enemyDefinitionId: 'ram_crew', laneId: 'gate_centre' },
  ],

  objectives: [
    {
      id: 'gate_holds',
      tier: 'BRONZE',
      kind: 'STATION_SURVIVES',
      description: 'The gate still stands at sixty seconds',
      stationId: 'main_gate',
    },
    {
      id: 'ram_defeated',
      tier: 'BRONZE',
      kind: 'ENEMIES_DEFEATED',
      description: 'The Ram Crew is destroyed',
      enemyDefinitionIds: ['ram_crew'],
    },
    {
      id: 'no_fractures',
      tier: 'SILVER',
      kind: 'NO_FRACTURES',
      description: 'No Echo fractures',
    },
    {
      id: 'echo_limit',
      tier: 'GOLD',
      kind: 'ECHO_LIMIT',
      description: 'Solved with three Echoes or fewer',
      maxEchoTracks: 3,
    },
  ],

  rewards: [
    { id: 'stability', kind: 'STABILITY', amount: 1 },
    { id: 'restore_gatehouse', kind: 'HUB_RESTORATION', targetId: 'gatehouse' },
    {
      id: 'first_choice',
      kind: 'UPGRADE_CHOICE',
      optionIds: ['handoff', 'swift_boots'],
    },
  ],

  // No panel carries more than two short sentences, and the timer holds while
  // a mandatory first-use instruction is on screen.
  tutorialSteps: [
    {
      id: 'move',
      runNumber: 0,
      text: 'Tap the ground to send the Warden there.',
      pausesTimer: true,
      completeOn: { kind: 'MOVE_ANYWHERE' },
    },
    {
      id: 'take-timber',
      runNumber: 0,
      text: 'Tap the timber stack to lift a bundle.',
      pausesTimer: true,
      highlightTargetId: 'timber_stack',
      completeOn: { kind: 'ITEM_TAKEN', itemDefinitionId: 'timber' },
    },
    {
      id: 'deliver-timber',
      runNumber: 0,
      text: 'Carry it to the carpenter bench.',
      pausesTimer: false,
      highlightTargetId: 'carpenter_bench',
      completeOn: { kind: 'ITEM_DELIVERED', stationId: 'carpenter_bench' },
    },
    {
      id: 'work-bench',
      runNumber: 0,
      text: 'Tap the bench again to saw it into planks.',
      pausesTimer: false,
      highlightTargetId: 'carpenter_bench',
      completeOn: { kind: 'RECIPE_COMPLETED', stationId: 'carpenter_bench' },
    },
    {
      id: 'repair-gate',
      runNumber: 0,
      text: 'Take a plank to the gate, then tap the gate to mend it.',
      pausesTimer: false,
      highlightTargetId: 'main_gate',
      completeOn: { kind: 'LOOP_ENDED' },
    },
    {
      id: 'echo-explained',
      runNumber: 1,
      text: 'The pale Warden will repeat everything you just did. Work alongside it.',
      pausesTimer: true,
      completeOn: { kind: 'ACKNOWLEDGED' },
    },
    {
      id: 'load-ballista',
      runNumber: 1,
      text: 'Take a bolt from the armoury and load the ballista.',
      pausesTimer: false,
      highlightTargetId: 'ballista',
      completeOn: { kind: 'ITEM_DELIVERED', stationId: 'ballista' },
    },
    {
      id: 'raid-warning',
      runNumber: 2,
      text: 'Raiders reach the gate at 39 seconds, a ram at 48. Ring the bell, then fire.',
      pausesTimer: true,
      highlightTargetId: 'hour_bell',
      completeOn: { kind: 'ACKNOWLEDGED' },
    },
  ],
};
