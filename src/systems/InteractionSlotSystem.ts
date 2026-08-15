import type { Vec2 } from '../core/types';
import { slotWorldPosition, type SimActor, type SimStation, type SimWorld } from './world';

/**
 * Interaction slot reservations (design document section 7.4).
 *
 * Reservations - not body collision - determine who may use a station. An
 * actor claims a slot only once it is close enough to start work, and a
 * reservation is released the instant its owner is stunned, displaced,
 * finished, or simply gone. That release-on-anything discipline is what
 * prevents the invisible deadlocks this system exists to avoid.
 */
export class InteractionSlotSystem {
  /** Frees every slot held by an actor. Safe to call repeatedly. */
  releaseAll(world: SimWorld, actorId: string): void {
    for (const station of world.stations.values()) {
      for (const slot of station.slots) {
        if (slot.occupantId === actorId) slot.occupantId = null;
      }
    }
  }

  release(station: SimStation, slotId: string, actorId: string): void {
    const slot = station.slots.find((s) => s.id === slotId);
    if (slot && slot.occupantId === actorId) slot.occupantId = null;
  }

  /**
   * Picks the free slot nearest the actor and reserves it.
   * Returns null when every slot is taken, which the caller surfaces as a
   * visible queue rather than a failure.
   */
  reserveNearest(station: SimStation, actor: SimActor): string | null {
    let bestId: string | null = null;
    let bestDistance = Infinity;

    for (const slot of station.slots) {
      if (slot.occupantId !== null && slot.occupantId !== actor.id) continue;
      const world = slotWorldPosition(station, slot);
      const distance = Math.hypot(world.x - actor.position.x, world.y - actor.position.y);
      // Stable tie-break on slot id keeps two identical actors deterministic.
      if (distance < bestDistance - 1e-9 || (Math.abs(distance - bestDistance) < 1e-9 && bestId !== null && slot.id < bestId)) {
        bestDistance = distance;
        bestId = slot.id;
      }
    }

    if (bestId === null) return null;
    const slot = station.slots.find((s) => s.id === bestId)!;
    slot.occupantId = actor.id;
    return bestId;
  }

  /** Where the actor should stand for a given reservation. */
  slotPosition(station: SimStation, slotId: string): Vec2 | null {
    const slot = station.slots.find((s) => s.id === slotId);
    return slot ? slotWorldPosition(station, slot) : null;
  }

  /**
   * Approach target used before a slot is reserved: the closest slot whether
   * or not it is free, so an actor walks to the queue instead of standing on
   * the far side of the courtyard waiting for space.
   */
  nearestSlotPosition(station: SimStation, from: Vec2): { slotId: string; position: Vec2 } | null {
    let best: { slotId: string; position: Vec2; distance: number } | null = null;
    for (const slot of station.slots) {
      const position = slotWorldPosition(station, slot);
      const distance = Math.hypot(position.x - from.x, position.y - from.y);
      if (!best || distance < best.distance - 1e-9) {
        best = { slotId: slot.id, position, distance };
      }
    }
    return best ? { slotId: best.slotId, position: best.position } : null;
  }

  /** Total live reservations - asserted by the restart regression test. */
  reservationCount(world: SimWorld): number {
    let count = 0;
    for (const station of world.stations.values()) {
      for (const slot of station.slots) if (slot.occupantId !== null) count += 1;
    }
    return count;
  }
}
