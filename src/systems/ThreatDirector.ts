import { Balance } from '../config/balance';
import { TICKS_PER_SECOND } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { PlayerSettings, ScenarioDefinition } from '../core/types';
import { getEnemyDefinition } from '../data/enemies';
import type { ProductionSystem } from './ProductionSystem';
import { createEnemy, type SimEnemy, type SimWorld } from './world';

/**
 * Deterministic threat schedule (design document section 11).
 *
 * Campaign schedules never use randomness: the same seed and the same tick
 * always produce the same arrival. Once the player has witnessed an event they
 * can plan around it, which is the entire basis of "deterministic fairness".
 */
export class ThreatDirector {
  private nextEnemyIndex = 0;

  constructor(
    private readonly bus: EventBus,
    private readonly scenario: ScenarioDefinition,
    private readonly production: ProductionSystem,
    private settings: PlayerSettings,
  ) {}

  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
  }

  reset(): void {
    this.nextEnemyIndex = 0;
  }

  private envelope(world: SimWorld, sourceId: string, targetId?: string) {
    return { tick: world.tick, scenarioId: this.scenario.id, sourceId, targetId };
  }

  private telegraphLead(): number {
    const extra = this.settings.earlyThreatMarkers ? Balance.threats.assistExtraTelegraphTicks : 0;
    return Balance.threats.telegraphLeadTicks + extra;
  }

  update(world: SimWorld): void {
    // Tutorial runs stay quiet so the player can learn the verbs in peace.
    if (!world.quietRun) {
      this.updateSchedule(world);
    }
    this.updateEnemies(world);
    this.updateProjectiles(world);
  }

  private updateSchedule(world: SimWorld): void {
    const lead = this.telegraphLead();

    for (const event of this.scenario.scheduledEvents) {
      if (event.kind !== 'SPAWN_ENEMY') continue;

      const telegraphId = `${event.id}:telegraph`;
      if (world.tick >= event.tick - lead && !world.firedEventIds.has(telegraphId)) {
        world.firedEventIds.add(telegraphId);
        const lane = this.scenario.lanes.find((l) => l.id === event.laneId);
        if (lane) {
          world.telegraphs.push({
            id: telegraphId,
            laneId: lane.id,
            enemyDefinitionId: event.enemyDefinitionId,
            spawnTick: event.tick,
          });
          this.bus.emit('THREAT_TELEGRAPHED', this.envelope(world, 'threat-director'), {
            enemyDefinitionId: event.enemyDefinitionId,
            lane: lane.id,
            arrivesInSeconds:
              (this.arrivalTick(event.tick, event.laneId, event.enemyDefinitionId) - world.tick) /
              TICKS_PER_SECOND,
          });
        }
      }

      if (world.tick >= event.tick && !world.firedEventIds.has(event.id)) {
        world.firedEventIds.add(event.id);
        this.spawn(world, event.id, event.enemyDefinitionId, event.laneId);
      }
    }

    // Clear telegraphs whose enemy has arrived.
    world.telegraphs = world.telegraphs.filter((t) => world.tick < t.spawnTick);
  }

  /** Tick at which an enemy on this lane reaches its attack position. */
  arrivalTick(spawnTick: number, laneId: string, enemyDefinitionId: string): number {
    const lane = this.scenario.lanes.find((l) => l.id === laneId);
    if (!lane) return spawnTick;
    const def = getEnemyDefinition(enemyDefinitionId);
    const distance = Math.hypot(lane.to.x - lane.from.x, lane.to.y - lane.from.y);
    return spawnTick + Math.round((distance / def.speed) * TICKS_PER_SECOND);
  }

  private spawn(world: SimWorld, eventId: string, enemyDefinitionId: string, laneId: string): void {
    if (world.enemies.size >= Balance.performance.maxEnemies) return;
    const lane = this.scenario.lanes.find((l) => l.id === laneId);
    if (!lane) return;

    const def = getEnemyDefinition(enemyDefinitionId);
    // Deterministic ID: derived from the scheduled event, never a counter that
    // could drift between runs.
    const id = `enemy-${eventId}-${this.nextEnemyIndex++}`;
    const enemy = createEnemy(id, def, lane.id, lane.from, lane.to, lane.targetStationId, world.tick);
    world.enemies.set(id, enemy);
    world.spawnedEnemyDefinitionIds.push(def.id);

    this.bus.emit('ENEMY_SPAWNED', this.envelope(world, 'threat-director', id), {
      enemyId: id,
      enemyDefinitionId: def.id,
      lane: lane.id,
    });
  }

  private updateEnemies(world: SimWorld): void {
    for (const enemy of world.enemies.values()) {
      if (enemy.state === 'DEAD') continue;
      if (enemy.flashTicks > 0) enemy.flashTicks -= 1;

      const def = getEnemyDefinition(enemy.definitionId);
      const stalled = world.tick < enemy.stallUntilTick;

      if (enemy.state === 'APPROACH') {
        if (stalled) continue;
        const dx = enemy.destination.x - enemy.position.x;
        const dy = enemy.destination.y - enemy.position.y;
        const distance = Math.hypot(dx, dy);
        const step = def.speed / TICKS_PER_SECOND;

        if (distance <= step) {
          enemy.position = { ...enemy.destination };
          enemy.state = 'ANTICIPATE';
          // Anticipation before the first blow: an attack must never land
          // without a readable wind-up.
          enemy.nextAttackTick = world.tick + def.anticipationTicks;
        } else {
          enemy.position = {
            x: enemy.position.x + (dx / distance) * step,
            y: enemy.position.y + (dy / distance) * step,
          };
        }
        continue;
      }

      if (stalled) continue;

      if (enemy.state === 'ANTICIPATE' && world.tick >= enemy.nextAttackTick) {
        enemy.state = 'ATTACK';
        enemy.nextAttackTick = world.tick;
      }

      if (enemy.state === 'ATTACK' && world.tick >= enemy.nextAttackTick) {
        this.strike(world, enemy, def.damage);
        enemy.nextAttackTick = world.tick + def.attackIntervalTicks;
      }
    }
  }

  private strike(world: SimWorld, enemy: SimEnemy, damage: number): void {
    const station = world.stations.get(enemy.targetStationId);
    if (!station || station.destroyed) return;
    this.production.damageStation(world, station, damage, enemy.id);
  }

  private updateProjectiles(world: SimWorld): void {
    for (const projectile of world.projectiles) {
      projectile.progress = Math.min(1, projectile.progress + projectile.speed);
    }
    world.projectiles = world.projectiles.filter((p) => p.progress < 1);
  }
}
