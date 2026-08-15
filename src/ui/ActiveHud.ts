import Phaser from 'phaser';
import { DESIGN_WIDTH, Depth, Palette, TICKS_PER_SECOND } from '../config/gameConfig';
import { getItem } from '../data/items';
import type { ScenarioSimulation } from '../systems/ScenarioSimulation';

/**
 * The always-on heads-up display (design document section 18).
 *
 * Layout: large loop timer with a phase ring top centre, objective state top
 * left, pause top right, carried item bottom centre. Resource counts are
 * deliberately absent - they live on the stockpile that holds them, because a
 * permanent readout of every number is exactly the density this game avoids.
 */
export class ActiveHud {
  private readonly root: Phaser.GameObjects.Container;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly objectiveText: Phaser.GameObjects.Text;
  private readonly runText: Phaser.GameObjects.Text;
  private readonly carriedIcon: Phaser.GameObjects.Image;
  private readonly carriedLabel: Phaser.GameObjects.Text;
  private readonly warningFlash: Phaser.GameObjects.Rectangle;
  private lastWholeSecond = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly topInset: number,
    largeText: boolean,
  ) {
    const scale = largeText ? 1.2 : 1;

    this.ring = scene.add.graphics();

    this.timerText = scene.add
      .text(DESIGN_WIDTH / 2, topInset + 34, '60', {
        fontSize: `${Math.round(30 * scale)}px`,
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5);

    this.objectiveText = scene.add
      .text(18, topInset + 18, '', {
        fontSize: `${Math.round(12 * scale)}px`,
        color: '#f0b357',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        wordWrap: { width: 130 },
      })
      .setOrigin(0, 0);

    this.runText = scene.add
      .text(18, topInset + 2, '', {
        fontSize: `${Math.round(10 * scale)}px`,
        color: '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 2,
      })
      .setOrigin(0, 0);

    this.carriedIcon = scene.add.image(DESIGN_WIDTH / 2, 0, 'item-plank').setVisible(false);
    this.carriedLabel = scene.add
      .text(DESIGN_WIDTH / 2, 0, '', {
        fontSize: `${Math.round(11 * scale)}px`,
        color: '#e8dcc0',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.warningFlash = scene.add
      .rectangle(DESIGN_WIDTH / 2, topInset + 34, DESIGN_WIDTH, 90, Palette.danger, 0)
      .setOrigin(0.5);

    this.root = scene.add.container(0, 0, [
      this.warningFlash,
      this.ring,
      this.timerText,
      this.objectiveText,
      this.runText,
      this.carriedIcon,
      this.carriedLabel,
    ]);
    this.root.setDepth(Depth.hud).setScrollFactor(0);
  }

  setCarriedPosition(y: number): void {
    this.carriedIcon.setY(y);
    this.carriedLabel.setY(y + 20);
  }

  update(simulation: ScenarioSimulation, reduceMotion: boolean): void {
    const remainingTicks = simulation.remainingTicks;
    const seconds = Math.ceil(remainingTicks / TICKS_PER_SECOND);
    const total = simulation.scenario.durationTicks;

    if (seconds !== this.lastWholeSecond) {
      this.lastWholeSecond = seconds;
      this.timerText.setText(String(Math.max(0, seconds)));
      // The last ten seconds tighten without becoming alarming.
      if (seconds <= 10 && seconds > 0) {
        this.timerText.setColor('#f0b357');
        if (!reduceMotion) {
          this.scene.tweens.add({
            targets: this.timerText,
            scale: 1.16,
            duration: 110,
            yoyo: true,
          });
        }
      } else {
        this.timerText.setColor('#f4e6cd');
      }
    }

    this.drawRing(1 - remainingTicks / total, seconds);

    const objective = simulation.objectives.primaryLine;
    this.objectiveText.setText(objective);

    const runNumber = simulation.currentRunNumber + 1;
    const echoes = simulation.getTracks().length;
    this.runText.setText(`LOOP ${runNumber}  ·  ${echoes} ECHO${echoes === 1 ? '' : 'ES'}`);

    this.syncCarried(simulation);
  }

  /** The phase ring: subtle, and the same shape as the Hour Bell face. */
  private drawRing(progress: number, seconds: number): void {
    const cx = DESIGN_WIDTH / 2;
    const cy = this.topInset + 34;
    const radius = 27;

    this.ring.clear();
    this.ring.lineStyle(3, Palette.stoneDark, 0.9);
    this.ring.strokeCircle(cx, cy, radius);

    const colour = seconds <= 10 ? Palette.readyGold : Palette.echoDeep;
    this.ring.lineStyle(3, colour, 1);
    this.ring.beginPath();
    this.ring.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
    this.ring.strokePath();
  }

  private syncCarried(simulation: ScenarioSimulation): void {
    const carrying = simulation.getWarden().carrying;
    if (!carrying) {
      this.carriedIcon.setVisible(false);
      this.carriedLabel.setVisible(false);
      return;
    }
    const item = getItem(carrying);
    this.carriedIcon.setTexture(item.textureKey).setVisible(true).setScale(1.3);
    this.carriedLabel.setText(item.displayName).setVisible(true);
  }

  /** Brief red wash when the gate takes a hit, for players with sound off. */
  flashDanger(reduceMotion: boolean): void {
    if (reduceMotion) return;
    this.warningFlash.setAlpha(0.28);
    this.scene.tweens.add({ targets: this.warningFlash, alpha: 0, duration: 320 });
  }

  setVisible(visible: boolean): void {
    this.root.setVisible(visible);
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
