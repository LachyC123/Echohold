import Phaser from 'phaser';
import type { GameContext } from '../GameContext';
import { DESIGN_WIDTH, Depth, Palette } from '../config/gameConfig';
import type { PlayerSettings } from '../core/types';
import { Button } from './Button';

interface ToggleRow {
  key: keyof PlayerSettings;
  label: string;
  hint?: string;
}

const COMFORT_ROWS: ToggleRow[] = [
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'No camera shake or flashes' },
  { key: 'highContrast', label: 'High contrast', hint: 'Stronger outlines on objectives' },
  { key: 'largeText', label: 'Larger text' },
  { key: 'hapticsEnabled', label: 'Vibration' },
];

const ASSIST_ROWS: ToggleRow[] = [
  { key: 'slowSimulation', label: 'Slower simulation', hint: 'Same puzzle, more thinking time' },
  { key: 'earlyThreatMarkers', label: 'Earlier threat markers' },
  { key: 'extendedTimeouts', label: 'Patient Echoes', hint: 'Commands wait longer before fracturing' },
  { key: 'autoPauseOnFracture', label: 'Pause on first fracture' },
];

/**
 * Settings, comfort options and save management.
 *
 * Every assist is changeable at any time and none of them block achievements,
 * story or upgrades (design document section 16). Destructive actions require
 * a second confirming tap.
 */
export class SettingsPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly buttons: Button[] = [];
  private confirmingReset = false;
  private resetButton: Button | null = null;
  private noticeText: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly context: GameContext,
    private readonly onClose: () => void,
  ) {
    const blocker = scene.add
      .rectangle(DESIGN_WIDTH / 2, scene.scale.height / 2, DESIGN_WIDTH, scene.scale.height, Palette.ink, 0.94)
      .setDepth(Depth.overlay)
      .setInteractive();
    this.objects.push(blocker);

    this.title('Settings', 46);

    let y = 90;
    y = this.section('Sound', y);
    y = this.slider('Music', 'musicVolume', y);
    y = this.slider('Effects', 'effectsVolume', y);

    y = this.section('Comfort', y + 6);
    for (const row of COMFORT_ROWS) y = this.toggle(row, y);

    y = this.section('Assists', y + 6);
    for (const row of ASSIST_ROWS) y = this.toggle(row, y);

    y = this.section('Save', y + 6);

    this.noticeText = scene.add
      .text(DESIGN_WIDTH / 2, scene.scale.height - 128, '', {
        fontSize: '11px',
        color: '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: DESIGN_WIDTH - 60 },
      })
      .setOrigin(0.5)
      .setDepth(Depth.overlay + 1);
    this.objects.push(this.noticeText);

    this.addButton(DESIGN_WIDTH / 2 - 72, y + 4, 'Export', () => this.exportSave(), 132, 'secondary');
    this.addButton(DESIGN_WIDTH / 2 + 72, y + 4, 'Import', () => this.importSave(), 132, 'secondary');

    this.resetButton = this.addButton(
      DESIGN_WIDTH / 2,
      y + 54,
      'Reset campaign',
      () => this.resetSave(),
      280,
      'danger',
    );

    this.addButton(DESIGN_WIDTH / 2, scene.scale.height - 78, 'Close', () => this.onClose(), 220, 'primary');
  }

  private title(text: string, y: number): void {
    const label = this.scene.add
      .text(DESIGN_WIDTH / 2, y, text, {
        fontSize: '22px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(Depth.overlay + 1);
    this.objects.push(label);
  }

  private section(text: string, y: number): number {
    const label = this.scene.add
      .text(24, y, text.toUpperCase(), {
        fontSize: '10px',
        color: '#647b91',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 3,
      })
      .setDepth(Depth.overlay + 1);
    this.objects.push(label);
    return y + 22;
  }

  private toggle(row: ToggleRow, y: number): number {
    const enabled = Boolean(this.context.settings[row.key]);

    const label = this.scene.add
      .text(24, y + 4, row.label, {
        fontSize: '13px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setDepth(Depth.overlay + 1);
    this.objects.push(label);

    if (row.hint) {
      const hint = this.scene.add
        .text(24, y + 20, row.hint, {
          fontSize: '10px',
          color: '#5d6d7e',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setDepth(Depth.overlay + 1);
      this.objects.push(hint);
    }

    const button = this.addButton(
      DESIGN_WIDTH - 62,
      y + 10,
      enabled ? 'On' : 'Off',
      () => {
        const next = !this.context.settings[row.key];
        this.context.updateSettings({ [row.key]: next } as Partial<PlayerSettings>);
        button.setText(next ? 'On' : 'Off').setSelected(next);
      },
      84,
      'secondary',
    );
    button.setSelected(enabled);

    return y + (row.hint ? 40 : 32);
  }

  /** Volume as four discrete steps: reliable to hit with a thumb. */
  private slider(label: string, key: 'musicVolume' | 'effectsVolume', y: number): number {
    const text = this.scene.add
      .text(24, y + 6, label, {
        fontSize: '13px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setDepth(Depth.overlay + 1);
    this.objects.push(text);

    const steps = [0, 0.35, 0.7, 1];
    const current = this.context.settings[key];
    const buttons: Button[] = [];

    steps.forEach((value, index) => {
      const button = this.addButton(
        DESIGN_WIDTH - 178 + index * 44,
        y + 12,
        index === 0 ? '✕' : '·'.repeat(index),
        () => {
          this.context.updateSettings({ [key]: value } as Partial<PlayerSettings>);
          buttons.forEach((b, i) => b.setSelected(i === index));
          this.context.audio.play('ui-tap');
        },
        40,
        'secondary',
      );
      button.setSelected(Math.abs(current - value) < 0.05);
      buttons.push(button);
    });

    return y + 38;
  }

  private addButton(
    x: number,
    y: number,
    text: string,
    onActivate: () => void,
    width: number,
    variant: 'primary' | 'secondary' | 'ghost' | 'danger',
  ): Button {
    const button = new Button(this.scene, x, y, text, onActivate, {
      width,
      height: 34,
      variant,
      fontSize: 12,
    });
    button.container.setDepth(Depth.overlay + 1);
    this.buttons.push(button);
    return button;
  }

  // --- Save management -----------------------------------------------------

  private exportSave(): void {
    const json = this.context.saves.exportJson(this.context.save);
    // The sandbox blocks downloads, so the clipboard is the reliable route.
    void navigator.clipboard
      ?.writeText(json)
      .then(() => this.notice('Save copied to the clipboard.'))
      .catch(() => {
        console.info('[echohold] save export:\n' + json);
        this.notice('Clipboard unavailable. The save was printed to the browser console.');
      });
  }

  private importSave(): void {
    const json = window.prompt('Paste an exported Echohold save');
    if (!json) return;
    const parsed = this.context.saves.importJson(json);
    if (!parsed) {
      this.notice('That save could not be read. Nothing was changed.');
      return;
    }
    this.context.setSave(parsed);
    this.context.persist();
    this.notice('Save imported.');
  }

  private resetSave(): void {
    if (!this.confirmingReset) {
      this.confirmingReset = true;
      this.resetButton?.setText('Tap again to erase');
      this.notice('This erases every medal and restoration. It cannot be undone.');
      return;
    }
    this.context.saves.reset();
    this.context.setSave(this.context.saves.createNew());
    this.context.persist();
    this.notice('Campaign reset.');
    this.confirmingReset = false;
    this.resetButton?.setText('Reset campaign');
  }

  private notice(message: string): void {
    this.noticeText.setText(message);
  }

  destroy(): void {
    for (const button of this.buttons) button.destroy();
    for (const object of this.objects) object.destroy();
  }
}
