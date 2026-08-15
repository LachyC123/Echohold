import Phaser from 'phaser';
import { Depth, Palette } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { DomainEvent, DomainEventName } from '../core/events';
import type { PlayerSettings } from '../core/types';
import type { AudioService } from './AudioService';
import type { QualityService } from './QualityService';
import type { SimWorld } from './world';

/**
 * Turns domain events into the audiovisual bundles described in section 17.
 *
 * This system only ever *reacts*. It never grants a resource or completes a
 * task - if it did, the timeline review and the rules would be able to
 * disagree, which is the one thing the event architecture exists to prevent.
 */
export class FeedbackSystem {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly particles: Phaser.GameObjects.Image[] = [];
  private particleCursor = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly bus: EventBus,
    private readonly audio: AudioService,
    private readonly quality: QualityService,
    private readonly world: () => SimWorld,
    private settings: PlayerSettings,
  ) {
    this.buildParticlePool();
    this.subscribe();
  }

  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
  }

  /** Pooled: no repeated particle is ever allocated during play. */
  private buildParticlePool(): void {
    const size = Math.round(48 * this.quality.effectScale);
    for (let i = 0; i < size; i++) {
      const image = this.scene.add
        .image(-100, -100, 'spark')
        .setDepth(Depth.effect)
        .setVisible(false)
        .setActive(false);
      this.particles.push(image);
    }
  }

  private subscribe(): void {
    const on = <K extends DomainEventName>(name: K, handler: (event: DomainEvent<K>) => void): void => {
      this.unsubscribers.push(this.bus.on(name, handler));
    };

    on('ITEM_TAKEN', (event) => {
      const actor = this.world().actors.get(event.payload.actorId);
      const quiet = actor?.kind === 'ECHO';
      this.audio.play('take-timber', quiet);
      if (actor) this.burst(actor.position.x, actor.position.y - 10, Palette.timber, 3);
      if (!quiet) this.audio.vibrate(8);
    });

    on('ITEM_DELIVERED', (event) => {
      const station = this.world().stations.get(event.payload.stationId);
      const actor = this.world().actors.get(event.payload.actorId);
      const quiet = actor?.kind === 'ECHO';
      this.audio.play('place-timber', quiet);
      if (station) this.burst(station.position.x, station.position.y, Palette.ochre, 5);
      // Light tick for a successful hand-off.
      if (!quiet) this.audio.vibrate(12);
    });

    on('RECIPE_STARTED', (event) => {
      const station = this.world().stations.get(event.payload.stationId);
      if (!station) return;
      this.audio.play(event.payload.recipeId === 'planks-from-timber' ? 'saw' : 'work-hammer', true);
    });

    on('RECIPE_COMPLETED', (event) => {
      const station = this.world().stations.get(event.payload.stationId);
      if (!station) return;
      this.audio.play('objective', true);
      this.burst(station.position.x, station.position.y - 10, Palette.rewardGold, 8);
      this.readinessPulse(station.position.x, station.position.y);
    });

    on('STATION_REPAIRED', (event) => {
      const station = this.world().stations.get(event.payload.stationId);
      if (!station) return;
      this.audio.play('work-hammer');
      this.floatingText(station.position.x, station.position.y - 30, `+${event.payload.amount}`, Palette.rewardGold);
    });

    on('STATION_DAMAGED', (event) => {
      const station = this.world().stations.get(event.payload.stationId);
      if (!station) return;
      this.audio.play('gate-impact');
      this.burst(station.position.x, station.position.y + 10, Palette.danger, 6);
      this.shake(0.004, 140);
      this.audio.vibrate(24);
    });

    on('STATION_DESTROYED', () => {
      this.audio.play('defeat');
      this.shake(0.012, 400);
      this.audio.vibrate([40, 60, 80]);
    });

    on('SIGNAL_EMITTED', (event) => {
      const station = this.world().stations.get(event.targetId ?? '');
      this.audio.play('bell');
      if (station) this.ring(station.position.x, station.position.y, Palette.rewardGold);
    });

    on('ENEMY_DEFEATED', (event) => {
      const enemy = this.world().enemies.get(event.payload.enemyId);
      this.audio.play('ballista-fire');
      if (enemy) this.burst(enemy.position.x, enemy.position.y, Palette.danger, 10);
      this.shake(0.005, 160);
    });

    on('ECHO_FRACTURED', (event) => {
      const actor = this.world().actors.get(event.payload.actorId);
      // Soft broken chime plus a brief cyan distortion.
      this.audio.play('fracture');
      if (actor) this.ring(actor.position.x, actor.position.y, Palette.timeTeal);
      this.audio.vibrate(30);
    });

    on('SCENARIO_STABILISED', () => {
      this.audio.play('stabilise');
      this.audio.vibrate([30, 40, 90]);
    });
  }

  // --- Effects -------------------------------------------------------------

  private nextParticle(): Phaser.GameObjects.Image | null {
    if (this.particles.length === 0) return null;
    const image = this.particles[this.particleCursor % this.particles.length]!;
    this.particleCursor += 1;
    return image;
  }

  /** Small dust or spark burst. Pooled and tween-driven. */
  burst(x: number, y: number, colour: number, count: number): void {
    const scaled = Math.max(1, Math.round(count * this.quality.effectScale));
    for (let i = 0; i < scaled; i++) {
      const particle = this.nextParticle();
      if (!particle) return;
      const angle = (i / scaled) * Math.PI * 2;
      const distance = 12 + (i % 3) * 6;
      particle
        .setPosition(x, y)
        .setTint(colour)
        .setAlpha(0.9)
        .setScale(0.7)
        .setVisible(true)
        .setActive(true);
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance - 6,
        alpha: 0,
        scale: 0.2,
        duration: 380,
        ease: 'Quad.easeOut',
        onComplete: () => particle.setVisible(false).setActive(false),
      });
    }
  }

  /** Expanding ring, used for signals and fractures. */
  ring(x: number, y: number, colour: number): void {
    const circle = this.scene.add.circle(x, y, 8).setStrokeStyle(2, colour, 0.9).setDepth(Depth.effect);
    this.scene.tweens.add({
      targets: circle,
      radius: 64,
      alpha: 0,
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => circle.destroy(),
    });
  }

  /** "This station is now ready" pulse on the destination. */
  readinessPulse(x: number, y: number): void {
    const circle = this.scene.add.circle(x, y, 26).setStrokeStyle(3, Palette.readyGold, 0.85).setDepth(Depth.effect);
    this.scene.tweens.add({
      targets: circle,
      radius: 38,
      alpha: 0,
      duration: 420,
      onComplete: () => circle.destroy(),
    });
  }

  floatingText(x: number, y: number, text: string, colour: number): void {
    const label = this.scene.add
      .text(x, y, text, {
        fontSize: '15px',
        color: `#${colour.toString(16).padStart(6, '0')}`,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(Depth.worldLabel);
    this.scene.tweens.add({
      targets: label,
      y: y - 26,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** Short and proportional, and fully disabled by Reduce Motion. */
  shake(intensity: number, durationMs: number): void {
    if (this.settings.reduceMotion) return;
    this.scene.cameras.main.shake(durationMs, intensity, false);
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    for (const particle of this.particles) particle.destroy();
    this.particles.length = 0;
  }
}
