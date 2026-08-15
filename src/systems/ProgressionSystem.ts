import { Balance } from '../config/balance';
import type { MedalTier, RewardDefinition, SaveDataV1, ScenarioDefinition } from '../core/types';
import type { SaveService } from './SaveService';

export interface GrantedReward {
  id: string;
  kind: RewardDefinition['kind'];
  headline: string;
  detail: string;
  /** Upgrade IDs the player must choose between, when applicable. */
  options?: string[];
}

const MEDAL_RANK: Record<MedalTier, number> = { BRONZE: 1, SILVER: 2, GOLD: 3 };

export const UPGRADE_LIBRARY: Record<string, { name: string; description: string }> = {
  handoff: {
    name: 'Hand-off',
    description: 'One Echo may pass a carried item straight to another at a marked meeting point.',
  },
  swift_boots: {
    name: 'Swift Boots',
    description: 'Faster travel, but a longer recovery after every dodge.',
  },
  recall: {
    name: 'Recall',
    description: 'Shift an entire saved track up to three seconds earlier or later.',
  },
  condition: {
    name: 'Condition',
    description: 'A command may wait for a named signal instead of a fixed tick.',
  },
};

export const HUB_SECTIONS: Record<string, { name: string; description: string }> = {
  gatehouse: {
    name: 'The Gatehouse',
    description: 'The north gate stands whole again, its timbers pale where they were mended.',
  },
  workshop: {
    name: 'The Workshop',
    description: 'Benches, sawdust, and the smell of resin. Recipes can be studied here.',
  },
  archive: {
    name: 'The Archive',
    description: 'Timelines and the Chronicle, kept against forgetting.',
  },
};

/**
 * Applies scenario results to the persistent campaign.
 *
 * Progression unlocks new verbs and relationships rather than percentages
 * (design document section 14). Stability is only ever earned by a first
 * completion and is never spent incorrectly; Memory Shards come from optional
 * mastery, so nobody has to replay for currency to advance the story.
 */
export class ProgressionSystem {
  constructor(private readonly saves: SaveService) {}

  /**
   * Records a completed scenario and returns the rewards to present.
   * Idempotent: re-completing a scenario upgrades the medal but never
   * re-awards stability or a restoration.
   */
  applyCompletion(
    save: SaveDataV1,
    scenario: ScenarioDefinition,
    medal: MedalTier,
  ): { save: SaveDataV1; rewards: GrantedReward[]; isFirstCompletion: boolean } {
    const isFirstCompletion = !save.completedScenarioIds.includes(scenario.id);
    const next: SaveDataV1 = {
      ...save,
      completedScenarioIds: isFirstCompletion
        ? [...save.completedScenarioIds, scenario.id]
        : save.completedScenarioIds,
      medalByScenarioId: { ...save.medalByScenarioId },
      restoredHubSectionIds: [...save.restoredHubSectionIds],
    };

    const previousMedal = save.medalByScenarioId[scenario.id];
    const improved = !previousMedal || MEDAL_RANK[medal] > MEDAL_RANK[previousMedal];
    if (improved) next.medalByScenarioId[scenario.id] = medal;

    const rewards: GrantedReward[] = [];

    for (const reward of scenario.rewards) {
      if (reward.requiresMedal && MEDAL_RANK[medal] < MEDAL_RANK[reward.requiresMedal]) continue;

      switch (reward.kind) {
        case 'STABILITY': {
          if (!isFirstCompletion) break;
          next.stability += reward.amount ?? Balance.economy.stabilityPerFirstCompletion;
          rewards.push({
            id: reward.id,
            kind: reward.kind,
            headline: 'The minute is stable',
            detail: 'This moment now belongs to the fortress outside the fracture.',
          });
          break;
        }

        case 'HUB_RESTORATION': {
          const sectionId = reward.targetId;
          if (!sectionId || next.restoredHubSectionIds.includes(sectionId)) break;
          next.restoredHubSectionIds.push(sectionId);
          const section = HUB_SECTIONS[sectionId];
          rewards.push({
            id: reward.id,
            kind: reward.kind,
            headline: section ? `${section.name} restored` : 'The fortress rebuilds',
            detail: section?.description ?? 'A section of the fortress returns.',
          });
          break;
        }

        case 'UPGRADE_CHOICE': {
          const options = (reward.optionIds ?? []).filter((id) => !next.unlockedUpgradeIds.includes(id));
          if (options.length === 0) break;
          rewards.push({
            id: reward.id,
            kind: reward.kind,
            headline: 'Choose what the Echoes learn',
            detail: 'Both remain earnable later. Pick the one you want now.',
            options,
          });
          break;
        }

        case 'MEMORY_SHARDS': {
          next.memoryShards += reward.amount ?? 0;
          break;
        }

        case 'RELIC_CHOICE':
          break;
      }
    }

    // Optional objectives are what pay out shards, so mastery is worth playing
    // for without ever being required.
    const shardAward = improved ? Balance.economy.shardsByMedal[medal] : 0;
    if (shardAward > 0) {
      next.memoryShards += shardAward;
      rewards.push({
        id: `shards-${medal.toLowerCase()}`,
        kind: 'MEMORY_SHARDS',
        headline: `${shardAward} Memory Shards`,
        detail: `Awarded for the ${medal.toLowerCase()} solution.`,
      });
    }

    return { save: next, rewards, isFirstCompletion };
  }

  chooseUpgrade(save: SaveDataV1, upgradeId: string): SaveDataV1 {
    if (save.unlockedUpgradeIds.includes(upgradeId)) return save;
    return { ...save, unlockedUpgradeIds: [...save.unlockedUpgradeIds, upgradeId] };
  }

  persist(save: SaveDataV1): boolean {
    return this.saves.save(save);
  }
}
