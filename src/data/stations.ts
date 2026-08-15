import { Balance } from '../config/balance';
import type { StationDefinition } from '../core/types';

/**
 * Opening chapter stations (design document section 10).
 *
 * Interaction slot positions are relative to the station's placed origin. A
 * station with two slots lets two actors work in parallel; a station with one
 * slot creates a deliberate queue the player has to plan around.
 *
 * Recipe grammar:
 *   - `autoStart` recipes run as soon as their inputs are present. Used only
 *     where the fiction is the machine working (a ballista winching itself).
 *   - Everything else needs a WORK command, because the physical act of
 *     tapping the ready station is the verb the player is learning.
 */
export const STATION_DEFINITIONS: StationDefinition[] = [
  {
    id: 'timber_stack',
    displayName: 'Timber Stack',
    kind: 'SOURCE',
    textureKey: 'station-timber-stack',
    interactionSlots: [
      { id: 'a', position: { x: 46, y: 4 }, facing: 180 },
      { id: 'b', position: { x: -46, y: 4 }, facing: 0 },
    ],
    acceptedItemTags: [],
    recipes: [],
    maxHealth: 0,
    stateVisualKeys: { idle: 'station-timber-stack', empty: 'station-timber-stack-empty' },
    initialStock: { timber: 2 },
    takeTicks: Balance.stations.timberStackTakeTicks,
    footprint: { width: 2, height: 2 },
  },
  {
    id: 'carpenter_bench',
    displayName: 'Carpenter Bench',
    kind: 'CRAFT',
    textureKey: 'station-carpenter-bench',
    interactionSlots: [{ id: 'a', position: { x: 48, y: 6 }, facing: 180 }],
    acceptedItemTags: ['timber'],
    recipes: [
      {
        id: 'planks-from-timber',
        inputs: [{ itemDefinitionId: 'timber', count: 1 }],
        outputs: [{ itemDefinitionId: 'plank', count: 2 }],
        workTicks: Balance.stations.carpenterWorkTicks,
      },
    ],
    maxHealth: 0,
    stateVisualKeys: {
      idle: 'station-carpenter-bench',
      ready: 'station-carpenter-bench-ready',
      active: 'station-carpenter-bench-active',
    },
    footprint: { width: 2, height: 2 },
  },
  {
    id: 'main_gate',
    displayName: 'Main Gate',
    kind: 'STRUCTURE',
    textureKey: 'station-gate',
    // Two repair slots: a bottleneck here would make the tutorial feel unfair.
    interactionSlots: [
      { id: 'a', position: { x: -34, y: 52 }, facing: 270 },
      { id: 'b', position: { x: 34, y: 52 }, facing: 270 },
    ],
    acceptedItemTags: ['repair-material'],
    recipes: [
      {
        id: 'gate-repair',
        inputs: [{ itemDefinitionId: 'plank', count: 1 }],
        outputs: [],
        workTicks: Balance.stations.repairWorkTicks,
        repairsTargetId: 'SELF',
        repairAmount: Balance.stations.repairAmount,
      },
    ],
    maxHealth: Balance.stations.gateMaxHealth,
    stateVisualKeys: {
      idle: 'station-gate',
      damaged: 'station-gate-damaged',
      critical: 'station-gate-critical',
      destroyed: 'station-gate-destroyed',
    },
    footprint: { width: 4, height: 2 },
  },
  {
    id: 'armoury_rack',
    displayName: 'Armoury Rack',
    kind: 'SOURCE',
    textureKey: 'station-armoury',
    interactionSlots: [
      { id: 'a', position: { x: -46, y: 4 }, facing: 0 },
      { id: 'b', position: { x: 46, y: 4 }, facing: 180 },
    ],
    acceptedItemTags: [],
    recipes: [],
    maxHealth: 0,
    stateVisualKeys: { idle: 'station-armoury', empty: 'station-armoury-empty' },
    initialStock: { bolt: 3 },
    takeTicks: Balance.stations.armouryTakeTicks,
    footprint: { width: 2, height: 2 },
  },
  {
    id: 'ballista',
    displayName: 'Ballista',
    kind: 'DEFENCE',
    textureKey: 'station-ballista',
    interactionSlots: [{ id: 'operator', position: { x: -44, y: 20 }, facing: 0 }],
    acceptedItemTags: ['bolt'],
    recipes: [
      {
        id: 'ballista-load',
        inputs: [{ itemDefinitionId: 'bolt', count: 1 }],
        outputs: [{ itemDefinitionId: 'loaded_shot', count: 1 }],
        workTicks: Balance.stations.ballistaLoadTicks,
        // The winch is the machine's own work; the actor is free to move on.
        autoStart: true,
      },
    ],
    maxHealth: 0,
    stateVisualKeys: {
      idle: 'station-ballista',
      loading: 'station-ballista-loading',
      ready: 'station-ballista-ready',
    },
    footprint: { width: 2, height: 2 },
  },
  {
    id: 'hour_bell',
    displayName: 'Hour Bell',
    kind: 'SIGNAL',
    textureKey: 'station-bell',
    interactionSlots: [
      { id: 'a', position: { x: 0, y: 50 }, facing: 270 },
      { id: 'b', position: { x: 0, y: -50 }, facing: 90 },
    ],
    acceptedItemTags: [],
    recipes: [],
    maxHealth: 0,
    stateVisualKeys: { idle: 'station-bell', ringing: 'station-bell-ringing' },
    footprint: { width: 3, height: 3 },
  },
];

export const STATIONS_BY_ID = new Map(STATION_DEFINITIONS.map((s) => [s.id, s]));

export function getStationDefinition(id: string): StationDefinition {
  const def = STATIONS_BY_ID.get(id);
  if (!def) throw new Error(`Unknown station definition: ${id}`);
  return def;
}

/** Pseudo-item produced by the ballista load recipe; never carried by hand. */
export const LOADED_SHOT_ITEM_ID = 'loaded_shot';
