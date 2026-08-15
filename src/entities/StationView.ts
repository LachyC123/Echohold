import Phaser from 'phaser';
import { Depth, Palette } from '../config/gameConfig';
import { getItem } from '../data/items';
import { getStationDefinition, LOADED_SHOT_ITEM_ID } from '../data/stations';
import type { SimStation } from '../systems/world';

/**
 * Visual body for one placed station.
 *
 * The physical state of a station must reveal readiness without text (design
 * document section 10), so this swaps textures, adds a gold rim light when it
 * can be used, and stacks the items it is actually holding on top of itself.
 * Nothing here mutates simulation state - it only reads it.
 */
export class StationView {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly rim: Phaser.GameObjects.Graphics;
  private readonly progress: Phaser.GameObjects.Graphics;
  private readonly healthBar: Phaser.GameObjects.Graphics | null;
  private readonly stackedItems: Phaser.GameObjects.Image[] = [];
  private readonly slotMarkers: Phaser.GameObjects.Image[] = [];
  private lastTextureKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    station: SimStation,
    private readonly highContrast: boolean,
  ) {
    const definition = getStationDefinition(station.definitionId);

    this.rim = scene.add.graphics();
    this.sprite = scene.add.image(0, 0, definition.textureKey).setOrigin(0.5, 0.5);
    this.progress = scene.add.graphics();
    this.healthBar = definition.maxHealth > 0 ? scene.add.graphics() : null;

    const parts: Phaser.GameObjects.GameObject[] = [this.rim, this.sprite, this.progress];
    if (this.healthBar) parts.push(this.healthBar);

    this.container = scene.add.container(station.position.x, station.position.y, parts);
    this.container.setDepth(Depth.stationBase + station.position.y * 0.001);

    // Working positions are scuffed patches of ground, not outlined boxes -
    // an unstyled rectangle in front of the player reads as a debug artefact.
    // They brighten only while the station is a valid target.
    for (const slot of station.slots) {
      const marker = scene.add
        .image(station.position.x + slot.position.x, station.position.y + slot.position.y, 'slot-marker')
        .setDepth(Depth.groundDecal)
        .setAlpha(0.07);
      this.slotMarkers.push(marker);
    }
  }

  sync(station: SimStation, canInteract: boolean): void {
    const definition = getStationDefinition(station.definitionId);
    const key = this.textureKeyFor(station);
    if (key !== this.lastTextureKey) {
      this.sprite.setTexture(key);
      this.lastTextureKey = key;
    }

    // Gold rim light: the one signal that means "you can use this now".
    this.rim.clear();
    if (canInteract) {
      const width = this.sprite.width + 10;
      const height = this.sprite.height + 10;
      this.rim.lineStyle(this.highContrast ? 4 : 2.5, Palette.readyGold, 0.9);
      this.rim.strokeRoundedRect(-width / 2, -height / 2, width, height, 6);
    }

    // Working positions surface only while the station is actually usable.
    for (const marker of this.slotMarkers) marker.setAlpha(canInteract ? 0.2 : 0.07);

    this.syncProgress(station);
    this.syncHealth(station, definition.maxHealth);
    this.syncHeldItems(station);

    if (station.flashTicks > 0) {
      this.sprite.setTint(0xffffff);
    } else {
      this.sprite.clearTint();
    }
  }

  private textureKeyFor(station: SimStation): string {
    const definition = getStationDefinition(station.definitionId);
    const visuals = definition.stateVisualKeys;

    if (definition.maxHealth > 0) {
      if (station.destroyed) return visuals['destroyed'] ?? definition.textureKey;
      const ratio = station.health / station.maxHealth;
      if (ratio <= 0.34) return visuals['critical'] ?? definition.textureKey;
      if (ratio < 1) return visuals['damaged'] ?? definition.textureKey;
      return visuals['idle'] ?? definition.textureKey;
    }

    if (definition.kind === 'DEFENCE') {
      if ((station.outputs[LOADED_SHOT_ITEM_ID] ?? 0) > 0) return visuals['ready'] ?? definition.textureKey;
      if (station.activeRecipeId) return visuals['loading'] ?? definition.textureKey;
      return visuals['idle'] ?? definition.textureKey;
    }

    if (definition.kind === 'SIGNAL') {
      return station.flashTicks > 0 ? visuals['ringing'] ?? definition.textureKey : visuals['idle'] ?? definition.textureKey;
    }

    if (definition.kind === 'SOURCE') {
      const empty = Object.values(station.stock).every((n) => n <= 0);
      return empty ? visuals['empty'] ?? definition.textureKey : visuals['idle'] ?? definition.textureKey;
    }

    if (station.activeRecipeId) return visuals['active'] ?? definition.textureKey;
    const hasInputs = Object.values(station.inputs).some((n) => n > 0);
    if (hasInputs) return visuals['ready'] ?? definition.textureKey;
    return visuals['idle'] ?? definition.textureKey;
  }

  private syncProgress(station: SimStation): void {
    this.progress.clear();
    if (!station.activeRecipeId) return;

    const definition = getStationDefinition(station.definitionId);
    const recipe = definition.recipes.find((r) => r.id === station.activeRecipeId);
    if (!recipe) return;

    const remaining = Math.max(0, station.workRemainingTicks);
    const ratio = 1 - remaining / recipe.workTicks;
    const width = this.sprite.width * 0.7;
    const y = this.sprite.height / 2 + 6;

    this.progress.fillStyle(Palette.ink, 0.55);
    this.progress.fillRoundedRect(-width / 2, y, width, 5, 2);
    this.progress.fillStyle(Palette.readyGold, 1);
    this.progress.fillRoundedRect(-width / 2, y, Math.max(2, width * ratio), 5, 2);
  }

  private syncHealth(station: SimStation, maxHealth: number): void {
    if (!this.healthBar || maxHealth <= 0) return;
    this.healthBar.clear();

    const ratio = Math.max(0, station.health / maxHealth);
    const width = this.sprite.width * 0.78;
    const y = -this.sprite.height / 2 - 12;

    this.healthBar.fillStyle(Palette.ink, 0.65);
    this.healthBar.fillRoundedRect(-width / 2, y, width, 6, 3);
    const colour = ratio > 0.6 ? Palette.rewardGold : ratio > 0.3 ? Palette.readyGold : Palette.danger;
    this.healthBar.fillStyle(colour, 1);
    this.healthBar.fillRoundedRect(-width / 2, y, Math.max(2, width * ratio), 6, 3);

    // Notches give the bar a readable scale without a number on screen.
    this.healthBar.fillStyle(Palette.ink, 0.5);
    for (let i = 1; i < 4; i++) {
      this.healthBar.fillRect(-width / 2 + (width / 4) * i, y, 1, 6);
    }
  }

  /**
   * Items delivered to a station physically appear on it, so a player can see
   * "the plank arrived" without opening anything.
   */
  private syncHeldItems(station: SimStation): void {
    const held: string[] = [];
    for (const [itemId, count] of Object.entries({ ...station.inputs, ...station.outputs })) {
      if (itemId === LOADED_SHOT_ITEM_ID) continue;
      for (let i = 0; i < Math.min(count, 3); i++) held.push(itemId);
    }
    for (const [itemId, count] of Object.entries(station.stock)) {
      for (let i = 0; i < Math.min(count, 2); i++) held.push(itemId);
    }

    while (this.stackedItems.length < held.length) {
      const image = this.scene.add.image(0, 0, 'item-plank').setScale(0.8);
      this.stackedItems.push(image);
      this.container.add(image);
    }

    this.stackedItems.forEach((image, index) => {
      const itemId = held[index];
      if (!itemId) {
        image.setVisible(false);
        return;
      }
      image.setVisible(true).setTexture(getItem(itemId).textureKey);
      image.setPosition(-14 + (index % 3) * 14, -this.sprite.height / 2 - 2 - Math.floor(index / 3) * 9);
    });
  }

  destroy(): void {
    this.container.destroy(true);
    for (const marker of this.slotMarkers) marker.destroy();
  }
}
