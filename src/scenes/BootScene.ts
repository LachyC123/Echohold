import Phaser from 'phaser';
import { generateTextures } from '../art/TextureFactory';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { ALL_SCENARIOS } from '../data/scenarios';
import { assertScenarioValid } from '../data/validation';
import { DESIGN_WIDTH, IS_DEV, Palette, SceneKeys } from '../config/gameConfig';

/**
 * Boot: build the art set, show honest progress, then hand off to the title.
 *
 * Every texture is generated rather than downloaded, so the "loading" stage is
 * real work rather than theatre - and a failure here is reported on screen
 * instead of leaving the player on a black canvas.
 */
export class BootScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.Boot);
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2;
    const cy = this.scale.height / 2;

    this.cameras.main.setBackgroundColor(Palette.ink);

    this.add
      .text(cx, cy - 70, 'ECHOHOLD', {
        fontSize: '34px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 10,
      })
      .setOrigin(0.5);

    this.label = this.add
      .text(cx, cy + 34, 'Waking the fortress', {
        fontSize: '13px',
        color: '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5);

    this.bar = this.add.graphics();
    this.drawProgress(0);

    // Generate on the next frame so the progress UI is actually painted first.
    this.time.delayedCall(30, () => this.buildAssets());
  }

  private drawProgress(ratio: number): void {
    const width = 190;
    const x = DESIGN_WIDTH / 2 - width / 2;
    const y = this.scale.height / 2;

    this.bar.clear();
    this.bar.fillStyle(Palette.stoneDark, 1);
    this.bar.fillRoundedRect(x, y, width, 6, 3);
    this.bar.fillStyle(Palette.readyGold, 1);
    this.bar.fillRoundedRect(x, y, Math.max(4, width * ratio), 6, 3);
  }

  private buildAssets(): void {
    try {
      generateTextures(this);
      this.validateContent();
      this.drawProgress(1);
      this.label.setText('Ready');

      const context = this.game.registry.get(CONTEXT_KEY) as GameContext | undefined;
      if (context?.loadNotice) {
        // Surface a recovered or unreadable save before the player invests
        // another session in it.
        this.label.setText(context.loadNotice).setColor('#f0b357').setWordWrapWidth(300).setAlign('center');
        this.time.delayedCall(2600, () => this.scene.start(SceneKeys.Title));
        return;
      }

      this.time.delayedCall(220, () => this.scene.start(SceneKeys.Title));
    } catch (error) {
      this.reportFailure(error);
    }
  }

  /**
   * Content validation runs at startup in development builds only. Invalid
   * IDs and impossible dependencies fail loudly here, where they are cheap to
   * find, rather than as a mystery mid-scenario.
   */
  private validateContent(): void {
    if (!IS_DEV) return;
    for (const scenario of ALL_SCENARIOS) assertScenarioValid(scenario);
  }

  private reportFailure(error: unknown): void {
    console.error('[echohold] asset generation failed', error);
    this.drawProgress(0);
    this.label
      .setText('The fortress art could not be built.\nReload to try again.')
      .setColor('#d4674a')
      .setAlign('center');

    this.input.once('pointerdown', () => window.location.reload());
  }
}
