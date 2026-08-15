import type { EventBus } from '../core/EventBus';
import type { MedalTier, ObjectiveDefinition, ScenarioDefinition } from '../core/types';
import { LOADED_SHOT_ITEM_ID } from '../data/stations';
import type { SimWorld } from './world';

export interface ObjectiveState {
  definition: ObjectiveDefinition;
  complete: boolean;
  impossible: boolean;
  progressText: string;
  reason?: string;
}

const TIER_ORDER: MedalTier[] = ['BRONZE', 'SILVER', 'GOLD'];

/**
 * Objective evaluation and the "objective impossible" early-out.
 *
 * A single early mistake must not force the player to watch a hopeless
 * 60-second loop (design document section 11), so impossibility is proven from
 * world state - not guessed at the end.
 */
export class ObjectiveSystem {
  private states: ObjectiveState[] = [];
  private fractureCount = 0;
  private echoTrackCount = 0;
  private announcedImpossible = false;

  constructor(
    private readonly bus: EventBus,
    private readonly scenario: ScenarioDefinition,
  ) {
    this.reset(0);
    // Fractures are counted from the event stream the review also reads, so
    // the silver medal can never disagree with the timeline.
    this.bus.on('ECHO_FRACTURED', () => {
      this.fractureCount += 1;
    });
  }

  reset(echoTrackCount: number): void {
    this.fractureCount = 0;
    this.echoTrackCount = echoTrackCount;
    this.announcedImpossible = false;
    this.states = this.scenario.objectives.map((definition) => ({
      definition,
      complete: false,
      impossible: false,
      progressText: '',
    }));
  }

  get objectiveStates(): readonly ObjectiveState[] {
    return this.states;
  }

  get fractures(): number {
    return this.fractureCount;
  }

  /** The single line the HUD shows at the top left. */
  get primaryLine(): string {
    const required = this.states.find((s) => s.definition.tier === 'BRONZE' && !s.complete);
    const target = required ?? this.states[0];
    return target ? target.progressText || target.definition.description : '';
  }

  private envelope(world: SimWorld, sourceId: string) {
    return { tick: world.tick, scenarioId: this.scenario.id, sourceId };
  }

  update(world: SimWorld): void {
    for (const state of this.states) {
      const previousComplete = state.complete;
      const previousImpossible = state.impossible;
      this.evaluate(world, state);

      if (state.complete !== previousComplete) {
        this.bus.emit('OBJECTIVE_UPDATED', this.envelope(world, state.definition.id), {
          objectiveId: state.definition.id,
          complete: state.complete,
          progressText: state.progressText,
        });
      }
      if (state.impossible && !previousImpossible) {
        this.bus.emit('OBJECTIVE_BECAME_IMPOSSIBLE', this.envelope(world, state.definition.id), {
          objectiveId: state.definition.id,
          reason: state.reason ?? 'The objective can no longer be met.',
        });
      }
    }
  }

  private evaluate(world: SimWorld, state: ObjectiveState): void {
    const def = state.definition;
    switch (def.kind) {
      case 'STATION_SURVIVES': {
        const station = def.stationId ? world.stations.get(def.stationId) : undefined;
        if (!station) {
          state.progressText = 'Structure missing';
          state.impossible = true;
          state.reason = 'The structure this objective protects is gone.';
          return;
        }
        state.progressText = `Gate ${Math.ceil(station.health)}/${station.maxHealth}`;
        // Only truly complete once the clock has run out.
        state.complete = !station.destroyed && world.finished;
        if (station.destroyed) {
          state.impossible = true;
          state.reason = 'The gate was breached.';
        }
        return;
      }

      case 'ENEMIES_DEFEATED': {
        const wanted = def.enemyDefinitionIds ?? [];
        const scheduled = this.scenario.scheduledEvents.filter(
          (e) => e.kind === 'SPAWN_ENEMY' && wanted.includes(e.enemyDefinitionId),
        ).length;
        const defeated = world.defeatedEnemyDefinitionIds.filter((id) => wanted.includes(id)).length;
        state.progressText = `Ram Crew ${defeated}/${scheduled}`;
        state.complete = scheduled > 0 && defeated >= scheduled;

        if (!state.complete) {
          const alive = Array.from(world.enemies.values()).some(
            (e) => e.state !== 'DEAD' && wanted.includes(e.definitionId),
          );
          // With no ammunition anywhere and the target still standing, the
          // loop is already decided. Say so now rather than at 60 seconds.
          if (alive && this.ammunitionRemaining(world) === 0) {
            state.impossible = true;
            state.reason = 'No bolt remains and the Ram Crew is still standing.';
          }
        }
        return;
      }

      case 'NO_FRACTURES':
        state.progressText = this.fractureCount === 0 ? 'No fractures' : `${this.fractureCount} fractures`;
        state.complete = this.fractureCount === 0;
        state.impossible = this.fractureCount > 0;
        if (state.impossible) state.reason = 'An Echo fractured.';
        return;

      case 'ECHO_LIMIT': {
        const limit = def.maxEchoTracks ?? this.scenario.maxEchoTracks;
        state.progressText = `${this.echoTrackCount}/${limit} Echoes`;
        state.complete = this.echoTrackCount <= limit;
        state.impossible = this.echoTrackCount > limit;
        if (state.impossible) state.reason = 'More Echoes were used than the gold target allows.';
        return;
      }

      case 'FIRES_EXTINGUISHED':
        state.progressText = '';
        state.complete = false;
        return;
    }
  }

  /** Bolts on racks, in hands, and already winched into a defence. */
  private ammunitionRemaining(world: SimWorld): number {
    let total = 0;
    for (const station of world.stations.values()) {
      total += station.stock['bolt'] ?? 0;
      total += station.outputs['bolt'] ?? 0;
      total += station.inputs['bolt'] ?? 0;
      total += station.outputs[LOADED_SHOT_ITEM_ID] ?? 0;
    }
    for (const actor of world.actors.values()) {
      if (actor.carrying === 'bolt') total += 1;
    }
    return total;
  }

  /** True when a required objective can no longer be met. */
  isRunHopeless(): boolean {
    return this.states.some((s) => s.definition.tier === 'BRONZE' && s.impossible);
  }

  /** Marks the announcement so the scene raises the banner exactly once. */
  claimImpossibleAnnouncement(): boolean {
    if (this.announcedImpossible || !this.isRunHopeless()) return false;
    this.announcedImpossible = true;
    return true;
  }

  /** Highest tier whose objectives - and all lower tiers - are complete. */
  awardedMedal(): MedalTier | null {
    let awarded: MedalTier | null = null;
    for (const tier of TIER_ORDER) {
      const tierStates = this.states.filter((s) => s.definition.tier === tier);
      const allComplete = tierStates.every((s) => s.complete);
      if (tierStates.length > 0 && !allComplete) break;
      if (tierStates.length > 0) awarded = tier;
    }
    return awarded;
  }

  /** Bronze is the story requirement; silver and gold are optional mastery. */
  isSuccess(): boolean {
    return this.states
      .filter((s) => s.definition.tier === 'BRONZE')
      .every((s) => s.complete);
  }
}
