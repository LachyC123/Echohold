import Phaser from 'phaser';
import { Depth, Palette } from '../config/gameConfig';
import { getEnemyDefinition } from '../data/enemies';
import type { SimEnemy } from '../systems/world';

/**
 * Visual body for one threat.
 *
 * Anticipation is drawn explicitly: an attack never lands without a visible
 * wind-up, and a stalled enemy shows the bell's teal hold so the player can see
 * their signal working (design document section 11).
 */
export class EnemyView {
  readonly container: Phaser.GameObjects.Container;
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly stallRing: Phaser.GameObjects.Arc;
  private phase = 0;

  constructor(
    scene: Phaser.Scene,
    enemy: SimEnemy,
    private readonly reduceMotion: boolean,
  ) {
    const definition = getEnemyDefinition(enemy.definitionId);
    this.shadow = scene.add.image(0, 12, 'shadow').setAlpha(0.32).setScale(0.85);
    this.sprite = scene.add.image(0, 0, definition.textureKey);
    this.stallRing = scene.add.circle(0, 0, 18).setStrokeStyle(2, Palette.timeTeal, 0).setFillStyle(0, 0);

    this.container = scene.add.container(enemy.position.x, enemy.position.y, [
      this.shadow,
      this.stallRing,
      this.sprite,
    ]);
    this.container.setDepth(Depth.actor + enemy.position.y * 0.001);
  }

  sync(enemy: SimEnemy, tick: number, delta: number): void {
    this.container.setPosition(enemy.position.x, enemy.position.y);
    this.container.setDepth(Depth.actor + enemy.position.y * 0.001);

    const stalled = tick < enemy.stallUntilTick;
    this.stallRing.setStrokeStyle(2, Palette.timeTeal, stalled ? 0.9 : 0);

    this.phase += delta * (enemy.state === 'APPROACH' && !stalled ? 0.012 : 0.005);
    const bob = this.reduceMotion ? 0 : Math.abs(Math.sin(this.phase)) * 2;
    this.sprite.setY(-bob);

    if (enemy.state === 'ANTICIPATE') {
      // Lean back before the blow: the tell the player is meant to read.
      this.sprite.setRotation(this.reduceMotion ? 0 : -0.22);
      this.sprite.setTint(Palette.rewardGold);
    } else if (enemy.state === 'ATTACK') {
      this.sprite.setRotation(this.reduceMotion ? 0 : Math.sin(this.phase * 3) * 0.16);
      this.sprite.clearTint();
    } else {
      this.sprite.setRotation(0);
      this.sprite.clearTint();
    }

    if (enemy.flashTicks > 0) this.sprite.setTint(0xffffff);
    this.container.setAlpha(enemy.state === 'DEAD' ? 0 : 1);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
