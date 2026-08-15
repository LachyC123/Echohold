import { TICKS_PER_SECOND } from '../config/gameConfig';
import { firstEvent, selectEvents, type DomainEvent } from '../core/events';
import type { TaskFailureReason } from '../core/types';

export interface Diagnosis {
  /** Tick the review should jump to. */
  tick: number;
  headline: string;
  detail: string;
  /** Station or actor the camera focuses on. */
  focusTargetId?: string;
}

const REASON_TEXT: Record<TaskFailureReason, string> = {
  TARGET_MISSING: 'the target was no longer there',
  TARGET_DESTROYED: 'the target had already been destroyed',
  UNREACHABLE: 'no route to it existed',
  SLOT_BUSY: 'every working position was taken',
  MISSING_INPUT: 'what it needed had not arrived',
  HANDS_FULL: 'its hands were already full',
  HANDS_EMPTY: 'it was carrying nothing to give',
  WRONG_ITEM: 'it was carrying the wrong thing',
  STORAGE_FULL: 'there was no room to put it',
  NOT_READY: 'the station was not ready',
  INTERRUPTED: 'it was interrupted',
  TIMEOUT: 'it waited past its patience',
  LOOP_ENDED: 'the minute ran out',
};

const seconds = (tick: number) => (tick / TICKS_PER_SECOND).toFixed(1);

/**
 * Turns the event journal into the first plain-language cause of failure.
 *
 * The rule this system obeys: a message is only produced from real event
 * dependencies, never guessed from the final state (design document section
 * 16). The game names the first broken dependency; it does not solve it.
 */
export class FractureAnalysisSystem {
  /**
   * @param journal chronological events for the loop just played
   * @param success whether the required objectives were met
   */
  analyse(journal: readonly DomainEvent[], success: boolean, quietRun = false): Diagnosis | null {
    if (success) return this.successNote(journal);

    // A practice minute has no threats to fail against, so reporting an
    // unmet objective would be both true and useless.
    if (quietRun) {
      const ended = firstEvent(journal, 'LOOP_ENDED');
      return {
        tick: ended?.tick ?? 0,
        headline: 'The fracture closes and the minute begins again.',
        detail:
          'Keep this run and a pale Warden will repeat every step of it while you do something else.',
      };
    }

    return (
      this.diagnoseBreach(journal) ??
      this.diagnoseUnansweredThreat(journal) ??
      this.diagnoseFirstFracture(journal) ??
      this.diagnoseFirstFailure(journal) ??
      this.fallback(journal)
    );
  }

  /** The single most useful moment to replay after a win. */
  private successNote(journal: readonly DomainEvent[]): Diagnosis | null {
    const stabilised = firstEvent(journal, 'SCENARIO_STABILISED');
    if (!stabilised) return null;
    return {
      tick: stabilised.tick,
      headline: 'The minute held.',
      detail: 'The fracture closed around this moment and the gate joined the standing fortress.',
    };
  }

  private diagnoseBreach(journal: readonly DomainEvent[]): Diagnosis | null {
    const destroyed = firstEvent(journal, 'STATION_DESTROYED');
    if (!destroyed) return null;

    const stationId = destroyed.payload.stationId;
    const firstHit = selectEvents(journal, 'STATION_DAMAGED').find(
      (e) => e.payload.stationId === stationId,
    );
    const repairs = selectEvents(journal, 'STATION_REPAIRED').filter(
      (e) => e.payload.stationId === stationId,
    );

    const detail = repairs.length
      ? `It was mended ${repairs.length === 1 ? 'once' : `${repairs.length} times`}, reaching ${
          repairs[repairs.length - 1]!.payload.health
        } health, but the blows from ${seconds(firstHit?.tick ?? 0)}s outpaced the repairs.`
      : `Nothing was ever delivered to mend it. It was struck from ${seconds(firstHit?.tick ?? 0)}s at 40 health.`;

    return {
      tick: destroyed.tick,
      headline: `The gate was breached at ${seconds(destroyed.tick)}s.`,
      detail,
      focusTargetId: stationId,
    };
  }

  /**
   * The example from the design document: a threat that survived because the
   * thing that answers it was never ready in time.
   */
  private diagnoseUnansweredThreat(journal: readonly DomainEvent[]): Diagnosis | null {
    const spawns = selectEvents(journal, 'ENEMY_SPAWNED');
    const defeats = selectEvents(journal, 'ENEMY_DEFEATED');
    const survivor = spawns.find(
      (spawn) =>
        spawn.payload.enemyDefinitionId === 'ram_crew' &&
        !defeats.some((d) => d.payload.enemyId === spawn.payload.enemyId),
    );
    if (!survivor) return null;

    const arrival = selectEvents(journal, 'STATION_DAMAGED').find(
      (e) => e.payload.byId === survivor.payload.enemyId,
    );
    const arrivalTick = arrival?.tick ?? survivor.tick;

    const loaded = selectEvents(journal, 'RECIPE_COMPLETED').find(
      (e) => e.payload.recipeId === 'ballista-load',
    );
    const boltDelivered = selectEvents(journal, 'ITEM_DELIVERED').find(
      (e) => e.payload.itemDefinitionId === 'bolt',
    );

    if (!boltDelivered) {
      return {
        tick: arrivalTick,
        headline: 'Ballista never fired: no bolt reached it.',
        detail: `The Ram Crew reached the gate at ${seconds(arrivalTick)}s with the ballista still empty.`,
        focusTargetId: 'ballista',
      };
    }

    if (!loaded) {
      return {
        tick: arrivalTick,
        headline: 'Ballista could not fire: the bolt arrived too late to winch.',
        detail: `The bolt was delivered at ${seconds(boltDelivered.tick)}s, ${(
          (arrivalTick - boltDelivered.tick) /
          TICKS_PER_SECOND
        ).toFixed(1)}s before the Ram Crew struck - the load needs 2.5s.`,
        focusTargetId: 'ballista',
      };
    }

    const lateBy = ((arrivalTick - loaded.tick) / TICKS_PER_SECOND).toFixed(1);
    return {
      tick: loaded.tick,
      headline: 'The ballista was loaded but never operated.',
      detail: `It stood ready from ${seconds(loaded.tick)}s, ${lateBy}s before the Ram Crew struck. Nobody took the operator position.`,
      focusTargetId: 'ballista',
    };
  }

  private diagnoseFirstFracture(journal: readonly DomainEvent[]): Diagnosis | null {
    const fracture = firstEvent(journal, 'ECHO_FRACTURED');
    if (!fracture) return null;

    const commandId = fracture.payload.commandId;
    const waiting = selectEvents(journal, 'COMMAND_WAITING').find(
      (e) => e.payload.commandId === commandId,
    );
    const waitedFor = waiting ? ((fracture.tick - waiting.tick) / TICKS_PER_SECOND).toFixed(1) : null;

    return {
      tick: fracture.tick,
      headline: `An Echo fractured at ${seconds(fracture.tick)}s.`,
      detail: waitedFor
        ? `It waited ${waitedFor}s because ${REASON_TEXT[fracture.payload.reason]}.`
        : `Its command failed because ${REASON_TEXT[fracture.payload.reason]}.`,
      focusTargetId: fracture.targetId ?? fracture.payload.actorId,
    };
  }

  private diagnoseFirstFailure(journal: readonly DomainEvent[]): Diagnosis | null {
    const failure = firstEvent(journal, 'COMMAND_FAILED');
    if (!failure) return null;
    return {
      tick: failure.tick,
      headline: `A command failed at ${seconds(failure.tick)}s.`,
      detail: `It stopped because ${REASON_TEXT[failure.payload.reason]}.`,
      focusTargetId: failure.targetId ?? failure.payload.actorId,
    };
  }

  private fallback(journal: readonly DomainEvent[]): Diagnosis {
    const ended = firstEvent(journal, 'LOOP_ENDED');
    return {
      tick: ended?.tick ?? 0,
      headline: 'Nothing broke - there simply was not enough of you.',
      detail:
        'Every command completed and the minute still ended short. Keep this run as an Echo so the next Warden starts where this one left off.',
    };
  }
}
