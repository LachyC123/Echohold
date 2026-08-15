import type { ItemDefinition } from '../core/types';

/**
 * Carried items. Tags drive station acceptance, so a later chapter can add a
 * reinforced plank that satisfies every `plank` recipe without editing them.
 */
export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'timber',
    displayName: 'Timber bundle',
    tags: ['timber', 'raw'],
    textureKey: 'item-timber',
    weight: 'STANDARD',
  },
  {
    id: 'plank',
    displayName: 'Plank',
    tags: ['plank', 'refined', 'repair-material'],
    textureKey: 'item-plank',
    weight: 'STANDARD',
  },
  {
    id: 'bolt',
    displayName: 'Ballista bolt',
    tags: ['bolt', 'ammunition'],
    textureKey: 'item-bolt',
    weight: 'STANDARD',
  },
];

export const ITEMS_BY_ID = new Map(ITEM_DEFINITIONS.map((item) => [item.id, item]));

export function getItem(id: string): ItemDefinition {
  const item = ITEMS_BY_ID.get(id);
  if (!item) throw new Error(`Unknown item definition: ${id}`);
  return item;
}

/** True when the item carries any of the tags a station will accept. */
export function itemMatchesTags(itemId: string, acceptedTags: readonly string[]): boolean {
  if (acceptedTags.length === 0) return false;
  const item = ITEMS_BY_ID.get(itemId);
  if (!item) return false;
  return item.tags.some((tag) => acceptedTags.includes(tag));
}
