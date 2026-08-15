import Phaser from 'phaser';
import { Palette } from '../config/gameConfig';

export interface ButtonOptions {
  width?: number;
  height?: number;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Selected buttons stay visibly latched, e.g. a chosen track slot. */
  selected?: boolean;
  fontSize?: number;
  icon?: string;
}

/**
 * One button with every state the design document requires: default, pressed,
 * disabled, selected and focus (section 18).
 *
 * Touch correctness matters more than looks here. Pointers are captured, the
 * pressed state is released when a finger leaves the bounds or the window
 * loses focus, and the hit area is padded to a comfortable thumb target even
 * when the drawn button is small.
 */
export class Button {
  readonly container: Phaser.GameObjects.Container;
  private readonly background: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly hit: Phaser.GameObjects.Rectangle;
  private readonly width: number;
  private readonly height: number;
  private readonly variant: NonNullable<ButtonOptions['variant']>;

  private disabled = false;
  private pressed = false;
  private focused = false;
  private selected: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    private readonly onActivate: () => void,
    options: ButtonOptions = {},
  ) {
    this.width = options.width ?? 180;
    this.height = options.height ?? 46;
    this.variant = options.variant ?? 'primary';
    this.selected = options.selected ?? false;

    this.background = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, options.icon ? `${options.icon}  ${text}` : text, {
        fontSize: `${options.fontSize ?? 15}px`,
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5);

    // A 44px minimum target, whatever the drawn size.
    this.hit = scene.add
      .rectangle(0, 0, Math.max(this.width, 44), Math.max(this.height, 44), 0x000000, 0)
      .setInteractive({ useHandCursor: true });

    this.container = scene.add.container(x, y, [this.background, this.label, this.hit]);
    this.redraw();

    this.hit.on('pointerdown', () => {
      if (this.disabled) return;
      this.pressed = true;
      this.redraw();
    });

    this.hit.on('pointerup', () => {
      if (this.disabled) return;
      const wasPressed = this.pressed;
      this.pressed = false;
      this.redraw();
      if (wasPressed) this.onActivate();
    });

    this.hit.on('pointerover', () => {
      this.focused = true;
      this.redraw();
    });

    // Finger slid off the button: cancel rather than firing, and drop focus.
    this.hit.on('pointerout', () => {
      this.focused = false;
      this.pressed = false;
      this.redraw();
    });

    // Losing window focus mid-press must not leave a stuck highlight.
    const releaseOnBlur = () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.redraw();
    };
    scene.game.events.on(Phaser.Core.Events.BLUR, releaseOnBlur);
    this.container.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.game.events.off(Phaser.Core.Events.BLUR, releaseOnBlur);
    });
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.hit.input!.enabled = !disabled;
    this.redraw();
    return this;
  }

  setSelected(selected: boolean): this {
    this.selected = selected;
    this.redraw();
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setVisible(visible: boolean): this {
    this.container.setVisible(visible);
    this.hit.input!.enabled = visible && !this.disabled;
    return this;
  }

  private redraw(): void {
    const g = this.background;
    const w = this.width;
    const h = this.height;
    g.clear();

    const fills: Record<string, number> = {
      primary: Palette.stoneBase,
      secondary: Palette.inkSoft,
      ghost: Palette.ink,
      danger: Palette.blockedRust,
    };
    let fill = fills[this.variant] ?? Palette.stoneBase;
    let alpha = this.variant === 'ghost' ? 0.55 : 0.95;
    let textColour = '#f4e6cd';

    if (this.disabled) {
      fill = Palette.inkSoft;
      alpha = 0.5;
      textColour = '#5d6d7e';
    } else if (this.pressed) {
      fill = Palette.readyGold;
      textColour = '#141a22';
    } else if (this.selected) {
      fill = Palette.ochre;
      textColour = '#141a22';
    }

    g.fillStyle(fill, alpha);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);

    // Focus and selection are shown by outline as well as fill, so state never
    // depends on colour alone.
    if (this.selected) {
      g.lineStyle(2, Palette.rewardGold, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    } else if (this.focused && !this.disabled) {
      g.lineStyle(2, Palette.readyGold, 0.8);
      g.strokeRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 12);
    } else if (this.variant === 'ghost') {
      g.lineStyle(1, Palette.stoneBase, 0.8);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    }

    this.label.setColor(textColour);
    this.label.setY(this.pressed ? 1 : 0);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
