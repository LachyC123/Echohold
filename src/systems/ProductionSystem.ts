import { Balance } from '../config/balance';
import type { EventBus } from '../core/EventBus';
import type { RecipeDefinition, TaskFailureReason } from '../core/types';
import { itemMatchesTags } from '../data/items';
import { getEnemyDefinition } from '../data/enemies';
import { getStationDefinition, LOADED_SHOT_ITEM_ID } from '../data/stations';
import type { SimActor, SimEnemy, SimStation, SimWorld } from './world';

/**
 * Station behaviour: stock, recipes, repairs, defences and signals.
 *
 * Every rule here emits a domain event. Presentation subscribes to those
 * events - nothing in the render layer is allowed to grant a resource or
 * finish a job (design document section 9).
 */
export class ProductionSystem {
  constructor(
    private readonly bus: EventBus,
    private readonly scenarioId: string,
  ) {}

  private envelope(world: SimWorld, sourceId: string, targetId?: string) {
    return { tick: world.tick, scenarioId: this.scenarioId, sourceId, targetId };
  }

  // --- Queries -------------------------------------------------------------

  /** What a tap on this station should mean for this actor, right now. */
  resolveDefaultAction(
    _world: SimWorld,
    station: SimStation,
    actor: SimActor,
    /** What the actor will be holding when this command runs. */
    carryingOverride?: string | null,
  ): 'TAKE' | 'DELIVER' | 'WORK' | 'OPERATE' | 'SIGNAL' | null {
    const def = getStationDefinition(station.definitionId);
    if (station.destroyed) return null;

    const carrying = carryingOverride !== undefined ? carryingOverride : actor.carrying;

    // Carrying something the station wants? Delivering is always the intent.
    if (carrying && itemMatchesTags(carrying, def.acceptedItemTags)) return 'DELIVER';

    if (def.kind === 'SIGNAL') return 'SIGNAL';

    if (def.kind === 'DEFENCE') {
      // Only a loaded defence offers an action. An empty one must not wear the
      // gold rim light, because that light means "you can use this now".
      return (station.outputs[LOADED_SHOT_ITEM_ID] ?? 0) > 0 ? 'OPERATE' : null;
    }

    if (!carrying) {
      if (this.hasTakeableOutput(station)) return 'TAKE';
      if (this.hasTakeableStock(station)) return 'TAKE';
      if (this.findReadyRecipe(station) !== null) return 'WORK';
    }
    return null;
  }

  hasTakeableOutput(station: SimStation): boolean {
    return Object.entries(station.outputs).some(([id, n]) => id !== LOADED_SHOT_ITEM_ID && n > 0);
  }

  hasTakeableStock(station: SimStation): boolean {
    return Object.values(station.stock).some((n) => n > 0);
  }

  /** First takeable item id, preferring finished outputs over raw stock. */
  nextTakeableItem(station: SimStation): string | null {
    for (const [id, n] of Object.entries(station.outputs)) {
      if (id !== LOADED_SHOT_ITEM_ID && n > 0) return id;
    }
    for (const [id, n] of Object.entries(station.stock)) {
      if (n > 0) return id;
    }
    return null;
  }

  /** A recipe whose inputs are all present and which is not already running. */
  findReadyRecipe(station: SimStation): RecipeDefinition | null {
    if (station.activeRecipeId !== null) return null;
    const def = getStationDefinition(station.definitionId);
    for (const recipe of def.recipes) {
      const satisfied = recipe.inputs.every(
        (input) => (station.inputs[input.itemDefinitionId] ?? 0) >= input.count,
      );
      if (!satisfied) continue;
      // Repair recipes are pointless at full health; report NOT_READY instead.
      if (recipe.repairsTargetId && station.health >= station.maxHealth) continue;
      return recipe;
    }
    return null;
  }

  canAccept(station: SimStation, itemId: string): boolean {
    const def = getStationDefinition(station.definitionId);
    return itemMatchesTags(itemId, def.acceptedItemTags);
  }

  // --- Mutations -----------------------------------------------------------

  /** Moves one item from a station into an actor's hands. */
  take(world: SimWorld, station: SimStation, actor: SimActor, wantedItemId?: string): TaskFailureReason | null {
    if (actor.carrying) return 'HANDS_FULL';
    const itemId = wantedItemId ?? this.nextTakeableItem(station);
    if (!itemId) return 'MISSING_INPUT';

    if ((station.outputs[itemId] ?? 0) > 0) {
      station.outputs[itemId] = (station.outputs[itemId] ?? 0) - 1;
    } else if ((station.stock[itemId] ?? 0) > 0) {
      station.stock[itemId] = (station.stock[itemId] ?? 0) - 1;
    } else {
      return 'MISSING_INPUT';
    }

    actor.carrying = itemId;
    this.bus.emit('ITEM_TAKEN', this.envelope(world, actor.id, station.id), {
      actorId: actor.id,
      itemDefinitionId: itemId,
    });
    station.flashTicks = 8;
    return null;
  }

  /** Moves the carried item into a station's input buffer. */
  deliver(world: SimWorld, station: SimStation, actor: SimActor): TaskFailureReason | null {
    if (!actor.carrying) return 'HANDS_EMPTY';
    if (!this.canAccept(station, actor.carrying)) return 'WRONG_ITEM';

    const itemId = actor.carrying;
    station.inputs[itemId] = (station.inputs[itemId] ?? 0) + 1;
    actor.carrying = null;

    this.bus.emit('ITEM_DELIVERED', this.envelope(world, actor.id, station.id), {
      actorId: actor.id,
      itemDefinitionId: itemId,
      stationId: station.id,
    });
    station.flashTicks = 8;

    // Machines that winch themselves start immediately; benches wait for a tap.
    const recipe = this.findReadyRecipe(station);
    if (recipe?.autoStart) this.startRecipe(world, station, recipe, null);
    return null;
  }

  startRecipe(world: SimWorld, station: SimStation, recipe: RecipeDefinition, workerId: string | null): void {
    station.activeRecipeId = recipe.id;
    station.workRemainingTicks = recipe.workTicks;
    station.workerId = workerId;
    for (const input of recipe.inputs) {
      station.inputs[input.itemDefinitionId] = (station.inputs[input.itemDefinitionId] ?? 0) - input.count;
    }
    this.bus.emit('RECIPE_STARTED', this.envelope(world, station.id), {
      stationId: station.id,
      recipeId: recipe.id,
    });
  }

  /** Advances autonomous station work (loading winches, and so on). */
  update(world: SimWorld): void {
    for (const station of world.stations.values()) {
      if (station.flashTicks > 0) station.flashTicks -= 1;
      if (station.activeRecipeId === null) continue;
      // Recipes driven by an actor are ticked by that actor's task instead.
      if (station.workerId !== null) continue;

      station.workRemainingTicks -= 1;
      if (station.workRemainingTicks <= 0) this.completeRecipe(world, station);
    }
  }

  completeRecipe(world: SimWorld, station: SimStation): void {
    const recipeId = station.activeRecipeId;
    if (!recipeId) return;
    const def = getStationDefinition(station.definitionId);
    const recipe = def.recipes.find((r) => r.id === recipeId);
    station.activeRecipeId = null;
    station.workRemainingTicks = 0;
    station.workerId = null;
    if (!recipe) return;

    const outputs: string[] = [];
    for (const output of recipe.outputs) {
      station.outputs[output.itemDefinitionId] = (station.outputs[output.itemDefinitionId] ?? 0) + output.count;
      outputs.push(output.itemDefinitionId);
    }

    if (recipe.repairsTargetId) {
      const target = recipe.repairsTargetId === 'SELF' ? station : world.stations.get(recipe.repairsTargetId);
      if (target) {
        const before = target.health;
        target.health = Math.min(target.maxHealth, target.health + (recipe.repairAmount ?? 0));
        this.bus.emit('STATION_REPAIRED', this.envelope(world, station.id, target.id), {
          stationId: target.id,
          amount: target.health - before,
          health: target.health,
        });
      }
    }

    this.bus.emit('RECIPE_COMPLETED', this.envelope(world, station.id), {
      stationId: station.id,
      recipeId,
      outputs,
    });
    station.flashTicks = 10;
  }

  // --- Defences and signals ------------------------------------------------

  /**
   * Fires a loaded defence at the frontmost enemy on its approach.
   * "Frontmost" means closest to the station it is defending, which is the
   * target a person watching the courtyard would expect to be shot.
   */
  operateDefence(world: SimWorld, station: SimStation, actor: SimActor): TaskFailureReason | null {
    if ((station.outputs[LOADED_SHOT_ITEM_ID] ?? 0) <= 0) return 'NOT_READY';

    const target = this.pickBallistaTarget(world);
    if (!target) return 'NOT_READY';

    station.outputs[LOADED_SHOT_ITEM_ID] = (station.outputs[LOADED_SHOT_ITEM_ID] ?? 0) - 1;
    world.projectiles.push({
      id: `${station.id}-shot-${world.tick}`,
      from: { ...station.position },
      to: { ...target.position },
      progress: 0,
      speed: 0.12,
    });

    this.damageEnemy(world, target, Balance.stations.ballistaDamage, actor.id);
    station.flashTicks = 12;
    return null;
  }

  private pickBallistaTarget(world: SimWorld): SimEnemy | null {
    let best: SimEnemy | null = null;
    let bestScore = -Infinity;
    for (const enemy of world.enemies.values()) {
      if (enemy.state === 'DEAD') continue;
      const def = getEnemyDefinition(enemy.definitionId);
      // Prefer the threat that cannot be answered any other way, then the one
      // closest to what it is attacking.
      const priority = def.stallable ? 0 : 1000;
      const score = priority + enemy.position.y;
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    return best;
  }

  damageEnemy(world: SimWorld, enemy: SimEnemy, amount: number, byId: string): void {
    if (enemy.state === 'DEAD') return;
    enemy.health -= amount;
    enemy.flashTicks = 6;
    if (enemy.health <= 0) {
      enemy.state = 'DEAD';
      world.defeatedEnemyDefinitionIds.push(enemy.definitionId);
      this.bus.emit('ENEMY_DEFEATED', this.envelope(world, byId, enemy.id), {
        enemyId: enemy.id,
        enemyDefinitionId: enemy.definitionId,
        byId,
      });
    }
  }

  /** Rings the Hour Bell: emits a named signal and stalls weak raiders. */
  emitSignal(world: SimWorld, station: SimStation, actor: SimActor): TaskFailureReason | null {
    if (world.tick < station.cooldownUntilTick) return 'NOT_READY';

    station.cooldownUntilTick = world.tick + Balance.stations.bellCooldownTicks;
    station.flashTicks = 16;
    const signalId = `${station.id}:ring`;
    world.signals.push({ signalId, tick: world.tick, byId: actor.id });

    for (const enemy of world.enemies.values()) {
      if (enemy.state === 'DEAD') continue;
      const def = getEnemyDefinition(enemy.definitionId);
      if (!def.stallable) continue;
      enemy.stallUntilTick = Math.max(enemy.stallUntilTick, world.tick + Balance.stations.bellStallTicks);
    }

    this.bus.emit('SIGNAL_EMITTED', this.envelope(world, actor.id, station.id), {
      signalId,
      byId: actor.id,
    });
    return null;
  }

  damageStation(world: SimWorld, station: SimStation, amount: number, byId: string): void {
    if (station.destroyed || station.maxHealth <= 0) return;
    station.health = Math.max(0, station.health - amount);
    station.flashTicks = 6;
    this.bus.emit('STATION_DAMAGED', this.envelope(world, byId, station.id), {
      stationId: station.id,
      amount,
      health: station.health,
      byId,
    });
    if (station.health <= 0) {
      station.destroyed = true;
      this.bus.emit('STATION_DESTROYED', this.envelope(world, byId, station.id), {
        stationId: station.id,
      });
    }
  }
}
