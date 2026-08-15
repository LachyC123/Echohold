import Phaser from 'phaser';
import { Depth, ECHO_COLOURS, Palette } from '../config/gameConfig';
import { getItem } from '../data/items';
import type { SimActor } from '../systems/world';

/**
 * Visual body for the Warden and every Echo.
 *
 * Poses are composed from a handful of tinted parts and driven by simple
 * trigonometry rather than a sprite sheet: it keeps the whole animation set in
 * one readable place, costs nothing to load, and gives the walk, carry, work
 * and operate poses the design document asks for. Echoes reuse the same motion
 * with a pale tint and an afterimage trail (section 17).
 */
export class ActorView {
  readonly container: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly legFront: Phaser.GameObjects.Image;
  private readonly legBack: Phaser.GameObjects.Image;
  private readonly armFront: Phaser.GameObjects.Image;
  private readonly body: Phaser.GameObjects.Image;
  private readonly head: Phaser.GameObjects.Image;
  private readonly carried: Phaser.GameObjects.Image;
  private readonly stateRing: Phaser.GameObjects.Arc;
  private readonly labelText: Phaser.GameObjects.Text | null;
  private readonly trail: Phaser.GameObjects.Graphics | null;
  private readonly tint: number;
  private phase = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    actor: SimActor,
    private readonly reduceMotion: boolean,
  ) {
    const isEcho = actor.kind === 'ECHO';
    this.tint = isEcho ? (ECHO_COLOURS[actor.colourIndex % ECHO_COLOURS.length] ?? Palette.echoPale) : Palette.wardenCream;

    this.shadow = scene.add.image(0, 12, 'shadow').setAlpha(isEcho ? 0.22 : 0.4);
    this.legBack = scene.add.image(-4, 8, 'actor-limb').setOrigin(0.5, 0).setTint(this.tint).setAlpha(0.7);
    this.legFront = scene.add.image(4, 8, 'actor-limb').setOrigin(0.5, 0).setTint(this.tint);
    this.body = scene.add.image(0, 0, 'actor-body').setOrigin(0.5, 0.5).setTint(this.tint);
    this.armFront = scene.add.image(8, -2, 'actor-limb').setOrigin(0.5, 0).setTint(this.tint).setScale(0.8);
    this.head = scene.add
      .image(0, -14, 'actor-head')
      .setTint(isEcho ? this.tint : Palette.parchment);
    this.carried = scene.add.image(0, -24, 'item-plank').setVisible(false);

    // Ring reads status without relying on colour alone: it also changes size.
    this.stateRing = scene.add.circle(0, 14, 13).setStrokeStyle(2, Palette.readyGold, 0).setFillStyle(0, 0);

    this.trail = isEcho && !reduceMotion ? scene.add.graphics() : null;

    const parts: Phaser.GameObjects.GameObject[] = [
      this.shadow,
      this.stateRing,
      this.legBack,
      this.legFront,
      this.body,
      this.armFront,
      this.head,
      this.carried,
    ];

    this.labelText = actor.label
      ? scene.add
          .text(0, -34, actor.label, {
            fontSize: '10px',
            color: '#cfe6ef',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          })
          .setOrigin(0.5)
      : null;
    if (this.labelText) parts.push(this.labelText);

    this.container = scene.add.container(actor.position.x, actor.position.y, parts);
    this.container.setDepth(Depth.actor);
    if (isEcho) {
      this.container.setAlpha(0.82);
      this.body.setAlpha(0.9);
    }
    if (this.trail) this.trail.setDepth(Depth.pathOverlay);
  }

  /** Called once per rendered frame. `delta` is in milliseconds. */
  sync(actor: SimActor, delta: number): void {
    this.container.setPosition(actor.position.x, actor.position.y);
    // Depth sorting by Y keeps the diorama readable when actors overlap.
    this.container.setDepth(Depth.actor + actor.position.y * 0.001);

    const moving = actor.animState === 'WALK' || actor.animState === 'CARRY_WALK';
    const working = actor.animState === 'WORK';
    const speed = moving ? 0.014 : working ? 0.02 : 0.004;
    this.phase += delta * speed;

    const swing = this.reduceMotion ? 0 : Math.sin(this.phase);

    if (moving) {
      this.legFront.setY(8 + swing * 2).setRotation(swing * 0.5);
      this.legBack.setY(8 - swing * 2).setRotation(-swing * 0.5);
      this.body.setY(Math.abs(swing) * -1.2);
      this.head.setY(-14 + Math.abs(swing) * -1.2);
    } else {
      this.legFront.setY(8).setRotation(0);
      this.legBack.setY(8).setRotation(0);
      // Idle breath keeps a stationary Echo feeling alive without noise.
      const breath = this.reduceMotion ? 0 : Math.sin(this.phase * 0.8) * 0.6;
      this.body.setY(breath);
      this.head.setY(-14 + breath);
    }

    // Work and operate get a distinct arm arc so the verb reads from a glance.
    if (working) {
      this.armFront.setRotation(-0.9 + Math.abs(swing) * 1.5);
    } else if (actor.animState === 'OPERATE') {
      this.armFront.setRotation(-1.2);
    } else if (actor.animState === 'TAKE' || actor.animState === 'PLACE') {
      this.armFront.setRotation(-0.7);
    } else {
      this.armFront.setRotation(moving ? -swing * 0.5 : 0);
    }

    // Face left or right; the three-quarter view only needs a horizontal flip.
    const facingLeft = Math.cos((actor.facing * Math.PI) / 180) < -0.2;
    this.container.setScale(facingLeft ? -1 : 1, 1);
    if (this.labelText) this.labelText.setScale(facingLeft ? -1 : 1, 1);

    this.syncCarried(actor);
    this.syncStateRing(actor);
    this.syncTrail(actor);
  }

  private syncCarried(actor: SimActor): void {
    if (!actor.carrying) {
      this.carried.setVisible(false);
      return;
    }
    const item = getItem(actor.carrying);
    this.carried.setTexture(item.textureKey).setVisible(true);
    // Held above the silhouette so it stays readable at phone size.
    this.carried.setPosition(0, -26);
  }

  private syncStateRing(actor: SimActor): void {
    const task = actor.task;
    if (actor.fractured) {
      this.stateRing.setStrokeStyle(2, Palette.timeTeal, 0.95);
      this.stateRing.setRadius(15);
      return;
    }
    if (task?.state === 'WAITING') {
      this.stateRing.setStrokeStyle(2, Palette.blockedRust, 0.9);
      this.stateRing.setRadius(13);
      return;
    }
    if (task?.state === 'ACTIVE') {
      this.stateRing.setStrokeStyle(2, Palette.readyGold, 0.85);
      this.stateRing.setRadius(13);
      return;
    }
    this.stateRing.setStrokeStyle(2, Palette.readyGold, 0);
  }

  private syncTrail(actor: SimActor): void {
    if (!this.trail) return;
    this.trail.clear();
    if (actor.trail.length < 2) return;
    // Low-opacity trailing edge: the Echo's signature reading.
    for (let i = 1; i < actor.trail.length; i++) {
      const a = actor.trail[i - 1]!;
      const b = actor.trail[i]!;
      this.trail.lineStyle(3, this.tint, (i / actor.trail.length) * 0.22);
      this.trail.beginPath();
      this.trail.moveTo(a.x, a.y);
      this.trail.lineTo(b.x, b.y);
      this.trail.strokePath();
    }
  }

  /** Short reaction used for hand-offs and completions. */
  pulse(): void {
    if (this.reduceMotion) return;
    this.scene.tweens.add({
      targets: this.container,
      scaleY: 1.12,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  destroy(): void {
    this.container.destroy(true);
    this.trail?.destroy();
  }
}
