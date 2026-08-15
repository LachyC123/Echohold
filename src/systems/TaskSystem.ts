import { Balance } from '../config/balance';
import { TICKS_PER_SECOND } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { EchoCommand, PlayerSettings, RuntimeTask, TaskFailureReason, Vec2 } from '../core/types';
import { getStationDefinition } from '../data/stations';
import type { InteractionSlotSystem } from './InteractionSlotSystem';
import type { NavigationSystem } from './NavigationSystem';
import type { ProductionSystem } from './ProductionSystem';
import type { SimActor, SimStation, SimWorld } from './world';

/**
 * Executes one semantic command at a time for a single actor.
 *
 * The state machine is deliberately shared by the live Warden and every Echo.
 * If replay used a different code path from recording, the two would drift
 * apart the moment either changed - and the whole game rests on the player
 * trusting that their Echo does what they did.
 *
 *   QUEUED -> MOVING -> (reserve slot) -> ACTIVE -> COMPLETE
 *                    \-> WAITING (visible queue) -/
 *                                      \-> FAILED (timeout / impossible)
 */
export class TaskSystem {
  constructor(
    private readonly bus: EventBus,
    private readonly scenarioId: string,
    private readonly nav: NavigationSystem,
    private readonly slots: InteractionSlotSystem,
    private readonly production: ProductionSystem,
    private settings: PlayerSettings,
  ) {}

  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
  }

  private envelope(world: SimWorld, sourceId: string, targetId?: string) {
    return { tick: world.tick, scenarioId: this.scenarioId, sourceId, targetId };
  }

  private timeoutFor(command: EchoCommand, travelTicks: number): number {
    const base = command.type === 'MOVE_TO' ? Balance.commands.moveTimeoutTicks : command.timeoutTicks;
    const multiplier = this.settings.extendedTimeouts ? Balance.commands.assistTimeoutMultiplier : 1;
    // A long walk is not impatience; give movement its own budget on top.
    return Math.round((base + travelTicks) * multiplier);
  }

  // --- Task lifecycle ------------------------------------------------------

  /** Begins a command, replacing whatever the actor was doing. */
  begin(world: SimWorld, actor: SimActor, command: EchoCommand): RuntimeTask {
    if (actor.task && actor.task.state !== 'COMPLETE' && actor.task.state !== 'FAILED') {
      this.cancel(world, actor, 'INTERRUPTED');
    }

    const task: RuntimeTask = {
      id: `${actor.id}:${command.id}`,
      actorId: actor.id,
      targetId: command.targetId ?? '',
      type: command.type,
      state: 'QUEUED',
      issuedTick: world.tick,
      dependencyEventIds: [],
      waitedTicks: 0,
      commandId: command.id,
    };
    actor.task = task;
    actor.fractured = false;

    this.bus.emit('COMMAND_ISSUED', this.envelope(world, actor.id, command.targetId), {
      commandId: command.id,
      type: command.type,
      actorId: actor.id,
    });

    this.enterQueued(world, actor, task, command);
    return task;
  }

  cancel(world: SimWorld, actor: SimActor, reason: TaskFailureReason): void {
    const task = actor.task;
    if (!task || task.state === 'COMPLETE' || task.state === 'FAILED') return;
    this.releaseWork(world, actor, task);
    task.state = 'FAILED';
    task.failureReason = reason;
    task.completedTick = world.tick;
    actor.path = [];
    actor.pathIndex = 0;
    actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';
  }

  /** Releases any slot and rolls back an in-progress station recipe. */
  private releaseWork(world: SimWorld, actor: SimActor, task: RuntimeTask): void {
    if (task.reservedSlotId && task.targetId) {
      const station = world.stations.get(task.targetId);
      if (station) {
        this.slots.release(station, task.reservedSlotId, actor.id);
        // A recipe this actor was personally driving stops when they leave.
        if (station.workerId === actor.id) {
          station.workerId = null;
          station.activeRecipeId = null;
          station.workRemainingTicks = 0;
        }
      }
    }
    task.reservedSlotId = undefined;
  }

  // --- State entry ---------------------------------------------------------

  private enterQueued(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    if (command.type === 'WAIT') {
      task.state = 'ACTIVE';
      task.startedTick = world.tick;
      task.workRemainingTicks = command.requestedDurationTicks ?? TICKS_PER_SECOND;
      actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';
      this.emitStarted(world, actor, command);
      return;
    }

    if (command.type === 'DODGE') {
      if (world.tick < actor.dodgeCooldownUntilTick) {
        this.fail(world, actor, task, command, 'NOT_READY');
        return;
      }
      const direction = this.dodgeDirection(actor, command);
      actor.dodgeVector = direction;
      actor.dodgeUntilTick = world.tick + Balance.actor.dodgeTicks;
      actor.dodgeCooldownUntilTick = world.tick + Balance.actor.dodgeCooldownTicks;
      task.state = 'ACTIVE';
      task.startedTick = world.tick;
      task.workRemainingTicks = Balance.actor.dodgeTicks;
      actor.animState = 'DODGE';
      this.emitStarted(world, actor, command);
      return;
    }

    // Everything else needs somewhere to walk to.
    const destination = this.destinationFor(world, actor, command);
    if (!destination) {
      this.fail(world, actor, task, command, command.targetId ? 'TARGET_MISSING' : 'UNREACHABLE');
      return;
    }

    const path = this.nav.findPath(actor.position, destination.point);
    if (path === null) {
      this.fail(world, actor, task, command, 'UNREACHABLE');
      return;
    }

    actor.path = path;
    actor.pathIndex = 0;
    task.state = 'MOVING';
    task.startedTick = world.tick;
    actor.animState = actor.carrying ? 'CARRY_WALK' : 'WALK';
    this.emitStarted(world, actor, command);

    // Already standing in the right place - resolve on this very tick.
    if (this.distanceTo(actor, destination.point) <= Balance.actor.slotArrivalRadius && path.length === 0) {
      this.onArrived(world, actor, task, command);
    }
  }

  private emitStarted(world: SimWorld, actor: SimActor, command: EchoCommand): void {
    this.bus.emit('COMMAND_STARTED', this.envelope(world, actor.id, command.targetId), {
      commandId: command.id,
      type: command.type,
      actorId: actor.id,
    });
  }

  private destinationFor(
    world: SimWorld,
    actor: SimActor,
    command: EchoCommand,
  ): { point: Vec2; stationId?: string } | null {
    if (command.type === 'MOVE_TO' && command.point) {
      const snapped = this.nav.snap(command.point);
      return snapped ? { point: snapped } : null;
    }
    if (!command.targetId) return null;

    const station = world.stations.get(command.targetId);
    if (!station) return null;

    const nearest = this.slots.nearestSlotPosition(station, actor.position);
    if (!nearest) return null;
    return { point: nearest.position, stationId: station.id };
  }

  private dodgeDirection(actor: SimActor, command: EchoCommand): Vec2 {
    if (command.point) {
      const dx = command.point.x - actor.position.x;
      const dy = command.point.y - actor.position.y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    }
    const radians = (actor.facing * Math.PI) / 180;
    return { x: Math.cos(radians), y: Math.sin(radians) };
  }

  // --- Per-tick update -----------------------------------------------------

  update(world: SimWorld, actor: SimActor, command: EchoCommand | null): void {
    const task = actor.task;
    if (!task || !command) {
      this.applyIdleAnimation(actor);
      return;
    }
    if (task.state === 'COMPLETE' || task.state === 'FAILED') return;

    const elapsed = world.tick - task.issuedTick;
    const travelBudget = this.estimateTravelTicks(actor, command);
    if (elapsed > this.timeoutFor(command, travelBudget)) {
      this.fail(world, actor, task, command, 'TIMEOUT');
      return;
    }
    // Reproduce a command the player abandoned partway through.
    if (command.maxRunTicks !== undefined && elapsed >= command.maxRunTicks) {
      this.cancel(world, actor, 'INTERRUPTED');
      return;
    }

    switch (task.state) {
      case 'MOVING':
        this.updateMoving(world, actor, task, command);
        break;
      case 'WAITING':
        task.waitedTicks += 1;
        this.tryStartWork(world, actor, task, command);
        break;
      case 'ACTIVE':
        this.updateActive(world, actor, task, command);
        break;
      default:
        break;
    }
  }

  private estimateTravelTicks(actor: SimActor, command: EchoCommand): number {
    if (command.type === 'WAIT' || command.type === 'DODGE') return 0;
    let remaining = 0;
    let cursor = actor.position;
    for (let i = actor.pathIndex; i < actor.path.length; i++) {
      const next = actor.path[i]!;
      remaining += Math.hypot(next.x - cursor.x, next.y - cursor.y);
      cursor = next;
    }
    const speed = this.speedOf(actor);
    return Math.ceil((remaining / Math.max(speed, 1)) * TICKS_PER_SECOND) + Balance.commands.slotQueueGraceTicks;
  }

  private speedOf(actor: SimActor): number {
    const base = actor.baseSpeed;
    const carryFactor = actor.carrying ? Balance.actor.carrySpeedMultiplier : 1;
    return base * carryFactor;
  }

  private updateMoving(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    const stepDistance = this.speedOf(actor) / TICKS_PER_SECOND;
    let budget = stepDistance;

    while (budget > 0 && actor.pathIndex < actor.path.length) {
      const target = actor.path[actor.pathIndex]!;
      const dx = target.x - actor.position.x;
      const dy = target.y - actor.position.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= budget || distance < 1e-6) {
        actor.position = { x: target.x, y: target.y };
        actor.pathIndex += 1;
        budget -= distance;
      } else {
        actor.position = {
          x: actor.position.x + (dx / distance) * budget,
          y: actor.position.y + (dy / distance) * budget,
        };
        actor.facing = (Math.atan2(dy, dx) * 180) / Math.PI;
        budget = 0;
      }
    }

    actor.animState = actor.carrying ? 'CARRY_WALK' : 'WALK';
    this.pushTrail(actor);

    if (actor.pathIndex >= actor.path.length) {
      this.bus.emit('ACTOR_MOVED', this.envelope(world, actor.id), {
        actorId: actor.id,
        x: Math.round(actor.position.x),
        y: Math.round(actor.position.y),
      });
      this.onArrived(world, actor, task, command);
    }
  }

  private onArrived(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    actor.path = [];
    actor.pathIndex = 0;

    if (command.type === 'MOVE_TO') {
      this.complete(world, actor, task, command);
      return;
    }
    task.state = 'WAITING';
    this.tryStartWork(world, actor, task, command);
  }

  /**
   * Attempts to claim a slot and begin work. Anything that is merely "not yet"
   * leaves the task in WAITING, which the HUD draws as a queue - only a
   * genuine impossibility fails immediately.
   */
  private tryStartWork(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    const station = command.targetId ? world.stations.get(command.targetId) : undefined;
    if (!station) {
      this.fail(world, actor, task, command, 'TARGET_MISSING');
      return;
    }
    if (station.destroyed) {
      this.fail(world, actor, task, command, 'TARGET_DESTROYED');
      return;
    }

    // Hard impossibilities are reported now rather than after a long wait.
    const blocking = this.hardBlocker(world, station, actor, command);
    if (blocking) {
      this.fail(world, actor, task, command, blocking);
      return;
    }

    if (!task.reservedSlotId) {
      const slotId = this.slots.reserveNearest(station, actor);
      if (!slotId) {
        this.wait(world, actor, task, command, 'SLOT_BUSY');
        return;
      }
      task.reservedSlotId = slotId;
    }

    // Stand exactly on the reserved slot before starting.
    const slotPosition = this.slots.slotPosition(station, task.reservedSlotId);
    if (slotPosition && this.distanceTo(actor, slotPosition) > Balance.actor.slotArrivalRadius) {
      const path = this.nav.findPath(actor.position, slotPosition);
      if (path === null) {
        this.fail(world, actor, task, command, 'UNREACHABLE');
        return;
      }
      // An empty path here would mean "nowhere to walk but not yet arrived",
      // which would ping-pong between MOVING and WAITING until the timeout.
      if (path.length === 0) {
        actor.position = { ...slotPosition };
      } else {
        actor.path = path;
        actor.pathIndex = 0;
        task.state = 'MOVING';
        return;
      }
    }
    if (slotPosition) {
      const slot = station.slots.find((s) => s.id === task.reservedSlotId);
      if (slot) actor.facing = slot.facing;
    }

    const soft = this.softBlocker(world, station, actor, command);
    if (soft) {
      this.wait(world, actor, task, command, soft);
      return;
    }

    this.beginWork(world, actor, task, command, station);
  }

  /** Conditions that can never resolve by waiting. */
  private hardBlocker(
    _world: SimWorld,
    station: SimStation,
    actor: SimActor,
    command: EchoCommand,
  ): TaskFailureReason | null {
    switch (command.type) {
      case 'TAKE':
        return actor.carrying ? 'HANDS_FULL' : null;
      case 'DELIVER':
        if (!actor.carrying) return 'HANDS_EMPTY';
        return this.production.canAccept(station, actor.carrying) ? null : 'WRONG_ITEM';
      default:
        return null;
    }
  }

  /** Conditions that may resolve if the actor is patient. */
  private softBlocker(
    world: SimWorld,
    station: SimStation,
    _actor: SimActor,
    command: EchoCommand,
  ): TaskFailureReason | null {
    switch (command.type) {
      case 'TAKE': {
        const wanted = command.itemDefinitionId;
        if (wanted) {
          const available = (station.outputs[wanted] ?? 0) + (station.stock[wanted] ?? 0);
          return available > 0 ? null : 'MISSING_INPUT';
        }
        return this.production.nextTakeableItem(station) ? null : 'MISSING_INPUT';
      }
      case 'WORK':
        return this.production.findReadyRecipe(station) ? null : 'MISSING_INPUT';
      case 'OPERATE': {
        const def = getStationDefinition(station.definitionId);
        if (def.kind !== 'DEFENCE') return 'NOT_READY';
        return (station.outputs['loaded_shot'] ?? 0) > 0 ? null : 'NOT_READY';
      }
      case 'SIGNAL':
        return world.tick < station.cooldownUntilTick ? 'NOT_READY' : null;
      default:
        return null;
    }
  }

  private beginWork(
    world: SimWorld,
    actor: SimActor,
    task: RuntimeTask,
    command: EchoCommand,
    station: SimStation,
  ): void {
    const def = getStationDefinition(station.definitionId);
    task.state = 'ACTIVE';
    task.startedTick = task.startedTick ?? world.tick;

    switch (command.type) {
      case 'TAKE':
        task.workRemainingTicks = def.takeTicks ?? Balance.stations.timberStackTakeTicks;
        actor.animState = 'TAKE';
        break;
      case 'DELIVER':
        task.workRemainingTicks = Math.round(TICKS_PER_SECOND * 0.4);
        actor.animState = 'PLACE';
        break;
      case 'WORK': {
        const recipe = this.production.findReadyRecipe(station);
        if (!recipe) {
          this.wait(world, actor, task, command, 'MISSING_INPUT');
          return;
        }
        this.production.startRecipe(world, station, recipe, actor.id);
        task.workRemainingTicks = recipe.workTicks;
        actor.animState = 'WORK';
        break;
      }
      case 'OPERATE':
        task.workRemainingTicks = Math.round(TICKS_PER_SECOND * 0.5);
        actor.animState = 'OPERATE';
        break;
      case 'SIGNAL':
        task.workRemainingTicks = Balance.stations.bellRingTicks;
        actor.animState = 'OPERATE';
        break;
      default:
        task.workRemainingTicks = 1;
        break;
    }
  }

  private updateActive(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    if (command.type === 'DODGE') {
      const distancePerTick = Balance.actor.dodgeDistance / Balance.actor.dodgeTicks;
      const next = {
        x: actor.position.x + actor.dodgeVector.x * distancePerTick,
        y: actor.position.y + actor.dodgeVector.y * distancePerTick,
      };
      if (this.nav.isPointWalkable(next)) actor.position = next;
      this.pushTrail(actor);
    }

    task.workRemainingTicks = (task.workRemainingTicks ?? 0) - 1;

    // A station-driven recipe keeps its own clock so the HUD ring matches.
    if (command.type === 'WORK' && command.targetId) {
      const station = world.stations.get(command.targetId);
      if (station && station.workerId === actor.id) {
        station.workRemainingTicks = Math.max(0, station.workRemainingTicks - 1);
      }
    }

    if ((task.workRemainingTicks ?? 0) > 0) return;

    const failure = this.applyEffect(world, actor, task, command);
    if (failure) this.fail(world, actor, task, command, failure);
    else this.complete(world, actor, task, command);
  }

  /** Where a command actually changes the world. */
  private applyEffect(
    world: SimWorld,
    actor: SimActor,
    task: RuntimeTask,
    command: EchoCommand,
  ): TaskFailureReason | null {
    if (command.type === 'WAIT' || command.type === 'DODGE' || command.type === 'MOVE_TO') return null;

    const station = command.targetId ? world.stations.get(command.targetId) : undefined;
    if (!station) return 'TARGET_MISSING';

    switch (command.type) {
      case 'TAKE':
        return this.production.take(world, station, actor, command.itemDefinitionId);
      case 'DELIVER':
        return this.production.deliver(world, station, actor);
      case 'WORK':
        if (station.workerId === actor.id) this.production.completeRecipe(world, station);
        else return 'INTERRUPTED';
        return null;
      case 'OPERATE':
        return this.production.operateDefence(world, station, actor);
      case 'SIGNAL':
        return this.production.emitSignal(world, station, actor);
      default:
        void task;
        return null;
    }
  }

  private wait(
    world: SimWorld,
    actor: SimActor,
    task: RuntimeTask,
    command: EchoCommand,
    reason: TaskFailureReason,
  ): void {
    if (task.state !== 'WAITING') {
      task.state = 'WAITING';
      this.bus.emit('COMMAND_WAITING', this.envelope(world, actor.id, command.targetId), {
        commandId: command.id,
        actorId: actor.id,
        reason,
      });
    }
    task.failureReason = reason;
    actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';
  }

  private complete(world: SimWorld, actor: SimActor, task: RuntimeTask, command: EchoCommand): void {
    this.releaseWork(world, actor, task);
    task.state = 'COMPLETE';
    task.completedTick = world.tick;
    task.failureReason = undefined;
    actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';
    this.bus.emit('COMMAND_COMPLETED', this.envelope(world, actor.id, command.targetId), {
      commandId: command.id,
      type: command.type,
      actorId: actor.id,
    });
  }

  private fail(
    world: SimWorld,
    actor: SimActor,
    task: RuntimeTask,
    command: EchoCommand,
    reason: TaskFailureReason,
  ): void {
    this.releaseWork(world, actor, task);
    task.state = 'FAILED';
    task.failureReason = reason;
    task.completedTick = world.tick;
    actor.path = [];
    actor.pathIndex = 0;
    actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';

    this.bus.emit('COMMAND_FAILED', this.envelope(world, actor.id, command.targetId), {
      commandId: command.id,
      actorId: actor.id,
      reason,
    });

    // Only Echoes fracture. The live Warden simply gets told "not now".
    if (actor.kind === 'ECHO' && actor.trackId) {
      actor.fractured = true;
      if (command.critical) actor.trackAbandoned = true;
      this.bus.emit('ECHO_FRACTURED', this.envelope(world, actor.id, command.targetId), {
        actorId: actor.id,
        trackId: actor.trackId,
        commandId: command.id,
        reason,
      });
    }
  }

  private applyIdleAnimation(actor: SimActor): void {
    if (actor.animState === 'WALK' || actor.animState === 'CARRY_WALK') {
      actor.animState = actor.carrying ? 'CARRY_IDLE' : 'IDLE';
    }
  }

  private pushTrail(actor: SimActor): void {
    actor.trail.push({ x: actor.position.x, y: actor.position.y });
    if (actor.trail.length > 14) actor.trail.shift();
  }

  private distanceTo(actor: SimActor, point: Vec2): number {
    return Math.hypot(point.x - actor.position.x, point.y - actor.position.y);
  }
}
