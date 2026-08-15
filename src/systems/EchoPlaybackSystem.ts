import type { EchoCommand, EchoTrack } from '../core/types';
import type { TaskSystem } from './TaskSystem';
import type { SimActor, SimWorld } from './world';

interface TrackCursor {
  track: EchoTrack;
  actorId: string;
  /** Index of the next command not yet dispatched. */
  index: number;
  /** Command currently being executed, for timeline reporting. */
  current: EchoCommand | null;
}

/**
 * Drives saved tracks alongside the live Warden.
 *
 * Commands are dispatched in order and become eligible at their recorded tick
 * (shifted by the track's Recall offset). If the previous command is still
 * running - because a slot was busy, or an input arrived late - the next one
 * queues rather than cutting it off. That queueing *is* the drift the timeline
 * review exists to explain, so it must be visible rather than hidden.
 */
export class EchoPlaybackSystem {
  private cursors: TrackCursor[] = [];

  constructor(private readonly tasks: TaskSystem) {}

  reset(): void {
    this.cursors = [];
  }

  register(track: EchoTrack, actorId: string): void {
    this.cursors.push({ track, actorId, index: 0, current: null });
  }

  /** The command an Echo is executing right now, for the HUD roster. */
  currentCommand(actorId: string): EchoCommand | null {
    return this.cursors.find((c) => c.actorId === actorId)?.current ?? null;
  }

  currentTrack(actorId: string): EchoTrack | null {
    return this.cursors.find((c) => c.actorId === actorId)?.track ?? null;
  }

  update(world: SimWorld): void {
    for (const cursor of this.cursors) {
      const actor = world.actors.get(cursor.actorId);
      if (!actor) continue;

      if (actor.trackAbandoned) {
        cursor.current = null;
        continue;
      }

      this.advance(world, actor, cursor);

      // Tick whatever the actor is currently doing.
      this.tasks.update(world, actor, cursor.current);
    }
  }

  private advance(world: SimWorld, actor: SimActor, cursor: TrackCursor): void {
    const busy =
      actor.task !== null && actor.task.state !== 'COMPLETE' && actor.task.state !== 'FAILED';
    if (busy) return;

    // The previous command finished (or fractured); the fallback decides
    // whether the rest of the track still runs.
    if (cursor.current && actor.task?.state === 'FAILED') {
      if (cursor.current.fallback === 'WAIT') {
        // Hold position for the remainder of this command's original window,
        // then continue. Prevents a fractured Echo sprinting ahead of plan.
        const next = cursor.track.commands[cursor.index];
        const resumeAt = next ? this.eligibleTick(cursor.track, next) : world.tick;
        if (world.tick < resumeAt) {
          cursor.current = null;
          return;
        }
      }
    }

    const next = cursor.track.commands[cursor.index];
    if (!next) {
      cursor.current = null;
      return;
    }

    if (world.tick < this.eligibleTick(cursor.track, next)) {
      cursor.current = null;
      return;
    }

    cursor.index += 1;
    cursor.current = next;
    this.tasks.begin(world, actor, next);
  }

  private eligibleTick(track: EchoTrack, command: EchoCommand): number {
    // Recall shifts a whole track; clamped by the ability, not here.
    return Math.max(0, command.issuedTick + (track.offsetTicks ?? 0));
  }

  /** Progress readout for the Echo roster: commands done / total. */
  progress(actorId: string): { done: number; total: number } {
    const cursor = this.cursors.find((c) => c.actorId === actorId);
    if (!cursor) return { done: 0, total: 0 };
    return { done: cursor.index, total: cursor.track.commands.length };
  }
}
