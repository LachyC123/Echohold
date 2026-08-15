import Phaser from 'phaser';
import { DESIGN_WIDTH, Depth, Palette } from '../config/gameConfig';
import type { EchoCommandType } from '../core/types';

export interface RadialOption {
  type: EchoCommandType;
  label: string;
  glyph: string;
  enabled: boolean;
  /** Why an option is unavailable, shown instead of silently greying out. */
  hint?: string;
}

/**
 * Press-and-hold choice wheel, shown only when a station genuinely supports
 * more than one action (design document section 8).
 *
 * Unavailable options stay visible with their reason attached: "no bolt here"
 * teaches the production grammar, while a missing button teaches nothing.
 */
export class RadialMenu {
  private readonly root: Phaser.GameObjects.Container;
  private readonly hint: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    screenX: number,
    screenY: number,
    title: string,
    options: RadialOption[],
    onChoose: (option: RadialOption) => void,
    onDismiss: () => void,
  ) {
    const blocker = scene.add
      .rectangle(DESIGN_WIDTH / 2, scene.scale.height / 2, DESIGN_WIDTH, scene.scale.height, Palette.ink, 0.55)
      .setInteractive();
    blocker.on('pointerup', () => onDismiss());

    // Keep the wheel fully on screen even when the press was near an edge.
    const cx = Phaser.Math.Clamp(screenX, 92, DESIGN_WIDTH - 92);
    const cy = Phaser.Math.Clamp(screenY, 150, scene.scale.height - 170);

    const label = scene.add
      .text(cx, cy - 92, title, {
        fontSize: '13px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5);

    this.hint = scene.add
      .text(cx, cy + 92, '', {
        fontSize: '11px',
        color: '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: 220 },
      })
      .setOrigin(0.5);

    const parts: Phaser.GameObjects.GameObject[] = [blocker, label, this.hint];
    const radius = 62;

    options.forEach((option, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, options.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      const disc = scene.add.circle(x, y, 27, option.enabled ? Palette.stoneBase : Palette.inkSoft, 0.96);
      disc.setStrokeStyle(2, option.enabled ? Palette.readyGold : Palette.stoneDark, 1);

      const glyph = scene.add
        .text(x, y - 6, option.glyph, {
          fontSize: '16px',
          color: option.enabled ? '#f4e6cd' : '#5d6d7e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(0.5);

      const text = scene.add
        .text(x, y + 12, option.label, {
          fontSize: '9px',
          color: option.enabled ? '#e8dcc0' : '#5d6d7e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(0.5);

      const hit = scene.add.circle(x, y, 30, 0x000000, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        if (option.enabled) onChoose(option);
        else this.hint.setText(option.hint ?? 'Not available right now.');
      });
      hit.on('pointerover', () => this.hint.setText(option.hint ?? ''));

      parts.push(disc, glyph, text, hit);
    });

    this.root = scene.add.container(0, 0, parts).setDepth(Depth.overlay).setScrollFactor(0);
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
