import { Balance } from '../config/balance';
import type { EnemyDefinition } from '../core/types';

/**
 * Opening chapter threats (design document section 11).
 *
 * Enemies exist to disturb schedules, not to become health-bar combat. Every
 * one has at least two counters, arrives on a readable lane, and telegraphs
 * before it acts.
 */
export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'raider',
    displayName: 'Raider',
    behaviour: 'RAIDER',
    textureKey: 'enemy-raider',
    health: Balance.threats.raiderHealth,
    speed: Balance.threats.raiderSpeed,
    damage: Balance.threats.raiderDamage,
    attackIntervalTicks: Balance.threats.raiderAttackIntervalTicks,
    stallable: true,
    anticipationTicks: Balance.threats.anticipationTicks,
  },
  {
    id: 'ram_crew',
    displayName: 'Ram Crew',
    behaviour: 'RAM_CREW',
    textureKey: 'enemy-ram',
    health: Balance.threats.ramHealth,
    speed: Balance.threats.ramSpeed,
    damage: Balance.threats.ramDamage,
    attackIntervalTicks: Balance.threats.ramAttackIntervalTicks,
    // A ram crew shrugs off the bell; it needs a bolt.
    stallable: false,
    anticipationTicks: Balance.threats.anticipationTicks,
  },
];

export const ENEMIES_BY_ID = new Map(ENEMY_DEFINITIONS.map((e) => [e.id, e]));

export function getEnemyDefinition(id: string): EnemyDefinition {
  const def = ENEMIES_BY_ID.get(id);
  if (!def) throw new Error(`Unknown enemy definition: ${id}`);
  return def;
}
