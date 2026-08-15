import Phaser from 'phaser';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { DESIGN_WIDTH, Depth, Palette, SceneKeys } from '../config/gameConfig';
import { Button } from '../ui/Button';

/**
 * Title.
 *
 * Deliberately thin: one tap opens the ruined courtyard. No login, settings
 * questionnaire, lore crawl or upgrade tree stands between the player and the
 * game (design document section 26).
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    const context = this.game.registry.get(CONTEXT_KEY) as GameContext;
    const cx = DESIGN_WIDTH / 2;
    const height = this.scale.height;

    this.cameras.main.setBackgroundColor(Palette.ink);
    this.paintBackdrop(height);

    this.add
      .text(cx, height * 0.2, 'ECHOHOLD', {
        fontSize: '44px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 12,
      })
      .setOrigin(0.5)
      .setDepth(Depth.hud);

    this.add
      .text(cx, height * 0.2 + 44, 'the hour that will not end', {
        fontSize: '13px',
        color: '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setDepth(Depth.hud);

    const hasProgress = context.hasProgress;

    new Button(
      this,
      cx,
      height - 150,
      hasProgress ? 'Continue' : 'Begin',
      () => {
        context.audio.unlock();
        context.audio.play('ui-tap');
        this.scene.start(SceneKeys.Hub);
      },
      { width: 220, height: 54, fontSize: 17 },
    ).container.setDepth(Depth.hud);

    if (hasProgress) {
      const medals = Object.keys(context.save.medalByScenarioId).length;
      this.add
        .text(
          cx,
          height - 102,
          `${context.save.completedScenarioIds.length} stabilised  ·  ${medals} medals  ·  ${context.save.memoryShards} shards`,
          {
            fontSize: '12px',
            color: '#647b91',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          },
        )
        .setOrigin(0.5)
        .setDepth(Depth.hud);
    }

    this.add
      .text(cx, height - 46, 'Portrait  ·  Offline  ·  No accounts', {
        fontSize: '11px',
        color: '#46586b',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(Depth.hud);
  }

  /**
   * A quiet silhouette of the fortress, so the title screen is already the
   * world rather than a menu in front of it.
   */
  private paintBackdrop(height: number): void {
    const horizon = Math.round(height * 0.64);

    // Sky, then the sunset glow, then the ground painted over it. Drawing the
    // glow first is what keeps it a light source behind the keep instead of a
    // disc lying on the grass.
    const sky = this.add.graphics().setDepth(Depth.ground);
    sky.fillStyle(Palette.timeViolet, 1);
    sky.fillRect(0, 0, DESIGN_WIDTH, horizon);
    sky.fillStyle(Palette.wardenAccent, 0.2);
    sky.fillCircle(DESIGN_WIDTH / 2, horizon - 30, 160);
    sky.fillStyle(Palette.readyGold, 0.16);
    sky.fillCircle(DESIGN_WIDTH / 2, horizon - 30, 96);

    // Keep and towers: the arch and bell shapes repeated from the courtyard.
    const buildings = this.add.graphics().setDepth(Depth.groundDecal);
    buildings.fillStyle(Palette.ink, 1);
    buildings.fillRect(150, horizon - 150, 180, 150);
    buildings.fillRect(96, horizon - 96, 44, 96);
    buildings.fillRect(340, horizon - 120, 44, 120);
    buildings.fillRoundedRect(206, horizon - 196, 68, 60, { tl: 34, tr: 34, bl: 0, br: 0 });

    // Broken merlons on the left tower: this fortress is a ruin.
    buildings.fillStyle(Palette.inkSoft, 1);
    buildings.fillTriangle(96, horizon - 96, 118, horizon - 118, 140, horizon - 92);

    const ground = this.add.graphics().setDepth(Depth.stationBase);
    ground.fillStyle(Palette.inkSoft, 1);
    ground.fillRect(0, horizon, DESIGN_WIDTH, height - horizon);
    ground.fillStyle(Palette.stoneDark, 0.5);
    ground.fillRect(0, horizon, DESIGN_WIDTH, 3);

    // Distant fires among the ruins.
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 90;
      const y = horizon + 26 + (i % 3) * 22;
      ground.fillStyle(Palette.readyGold, 0.12);
      ground.fillCircle(x, y, 9);
      ground.fillStyle(Palette.readyGold, 0.6);
      ground.fillCircle(x, y, 2);
    }
  }
}
