import { TICKS_PER_SECOND } from './gameConfig';

const s = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);

/**
 * Every tuning variable named in design document section 16 lives here, so
 * balancing never requires editing loop code.
 *
 * The opening scenario is tuned around one arithmetic promise: repairing the
 * gate alone is not enough, and defending alone is not enough. The player has
 * to do both, which is exactly what forces the second Echo.
 *
 *   Gate starts at 40/100. One timber becomes two planks, and two planks
 *   restore it to full - so the ceiling on repair is exactly 100.
 *   Two Raiders arrive at 39s, each striking for 2 every 2s  -> 2/s combined.
 *   The Ram Crew arrives at 48s and strikes for 12 every 2s.
 *
 *   Do nothing              : gate gone by ~54s                      -> loss
 *   Repair only (-> 100)    : 41 raider + 72 ram = 113 by 60s        -> loss
 *   Repair + bell, no shot  : bell buys 4s (33 raider) + 72 ram      -> loss
 *   Repair + bell + a shot
 *     that lands after three
 *     ram blows (~53s)      : 33 + 36 = 69   -> gate holds on 31     -> Bronze
 *   Repair + bell + a shot
 *     that lands on arrival : 33 + 12 = 45   -> gate holds on 55     -> mastery
 *
 * The last two lines are the point: a correct plan wins with room to spare,
 * and a well-timed one wins handsomely. Neither depends on hidden randomness.
 */
export const Balance = {
  actor: {
    /** World units per second. */
    wardenSpeed: 128,
    echoSpeed: 128,
    /** Carrying a standard item costs a little pace, which makes routes matter. */
    carrySpeedMultiplier: 0.9,
    /** How close counts as "arrived" at an interaction slot. */
    slotArrivalRadius: 9,
    dodgeTicks: s(0.35),
    dodgeDistance: 84,
    dodgeCooldownTicks: s(2.5),
  },

  commands: {
    /** Default patience before a command fractures. */
    defaultTimeoutTicks: s(8),
    /** The extended-timeouts assist multiplies this. */
    assistTimeoutMultiplier: 1.75,
    /** Movement gets its own budget; long walks are legitimate. */
    moveTimeoutTicks: s(14),
    /** Slot contention is normal and should read as a queue, not a failure. */
    slotQueueGraceTicks: s(4),
  },

  stations: {
    timberStackTakeTicks: s(1.2),
    carpenterWorkTicks: s(3.0),
    repairWorkTicks: s(3.5),
    repairAmount: 30,
    armouryTakeTicks: s(1.0),
    ballistaLoadTicks: s(2.5),
    ballistaDamage: 3,
    bellRingTicks: s(2.0),
    /** Hour Bell stall applied to weak raiders. */
    bellStallTicks: s(4.0),
    bellCooldownTicks: s(6.0),
    gateMaxHealth: 100,
  },

  threats: {
    raiderHealth: 1,
    raiderDamage: 2,
    raiderAttackIntervalTicks: s(2.0),
    raiderSpeed: 60,
    ramHealth: 3,
    ramDamage: 12,
    ramAttackIntervalTicks: s(2.0),
    ramSpeed: 35,
    /** Anticipation before the first blow, so a hit is never a surprise. */
    anticipationTicks: s(0.6),
    /** Telegraph markers appear this far ahead of a spawn. */
    telegraphLeadTicks: s(3.0),
    /** The early-markers assist adds this much extra warning. */
    assistExtraTelegraphTicks: s(2.0),
  },

  assists: {
    /** Slow simulation keeps the same tick count, only the wall clock stretches. */
    slowSimulationRate: 0.85,
  },

  economy: {
    stabilityPerFirstCompletion: 1,
    shardsByMedal: { BRONZE: 0, SILVER: 2, GOLD: 5 } as const,
  },

  performance: {
    maxFriendlyActors: 8,
    maxEnemies: 12,
  },
} as const;

export const seconds = s;
