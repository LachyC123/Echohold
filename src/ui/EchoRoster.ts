import Phaser from 'phaser';
import { Depth, ECHO_COLOURS, Palette } from '../config/gameConfig';
import type { ScenarioSimulation } from '../systems/ScenarioSimulation';

type EchoState = 'WORKING' | 'MOVING' | 'WAITING' | 'FRACTURED' | 'DONE';

const STATE_GLYPH: Record<EchoState, string> = {
  WORKING: '◆',
  MOVING: '»',
  WAITING: '‖',
  FRACTURED: '✕',
  DONE: '·',
};

const STATE_COLOUR: Record<EchoState, number> = {
  WORKING: Palette.readyGold,
  MOVING: Palette.echoPale,
  WAITING: Palette.blockedRust,
  FRACTURED: Palette.timeTeal,
  DONE: Palette.muted,
};

interface Row {
  container: Phaser.GameObjects.Container;
  swatch: Phaser.GameObjects.Rectangle;
  glyph: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
}

/**
 * Compact vertical Echo portraits down the left edge (design document section
 * 18).
 *
 * Each row carries a colour, a glyph and a word, so state never depends on
 * colour alone. This is the panel a player glances at to answer "which of me
 * is stuck?" without leaving the loop.
 */
export class EchoRoster {
  private readonly root: Phaser.GameObjects.Container;
  private readonly rows: Row[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
  ) {
    this.root = scene.add.container(0, 0).setDepth(Depth.hud).setScrollFactor(0);
  }

  update(simulation: ScenarioSimulation): void {
    const tracks = simulation.getTracks();
    const world = simulation.getWorld();

    while (this.rows.length < tracks.length) this.rows.push(this.buildRow(this.rows.length));

    this.rows.forEach((row, index) => {
      const track = tracks[index];
      if (!track) {
        row.container.setVisible(false);
        return;
      }
      row.container.setVisible(true);

      const actorId = `echo-${index}-${track.id}`;
      const actor = world.actors.get(actorId);
      const state = this.stateOf(simulation, actorId);

      row.swatch.setFillStyle(ECHO_COLOURS[track.colourIndex % ECHO_COLOURS.length] ?? Palette.echoPale, 1);
      row.glyph.setText(STATE_GLYPH[state]).setColor(hex(STATE_COLOUR[state]));
      row.label.setText(track.label ?? `Echo ${index + 1}`);

      const progress = simulation.playback.progress(actorId);
      const ratio = progress.total > 0 ? progress.done / progress.total : 0;
      row.progress.clear();
      row.progress.fillStyle(Palette.ink, 0.6);
      row.progress.fillRoundedRect(0, 0, 40, 3, 1.5);
      row.progress.fillStyle(STATE_COLOUR[state], 1);
      row.progress.fillRoundedRect(0, 0, Math.max(2, 40 * ratio), 3, 1.5);

      row.container.setAlpha(actor ? 1 : 0.4);
    });
  }

  private stateOf(simulation: ScenarioSimulation, actorId: string): EchoState {
    const actor = simulation.getWorld().actors.get(actorId);
    if (!actor) return 'DONE';
    if (actor.fractured) return 'FRACTURED';
    const task = actor.task;
    if (!task || task.state === 'COMPLETE' || task.state === 'FAILED') {
      const progress = simulation.playback.progress(actorId);
      return progress.done >= progress.total ? 'DONE' : 'MOVING';
    }
    if (task.state === 'WAITING') return 'WAITING';
    if (task.state === 'MOVING') return 'MOVING';
    return 'WORKING';
  }

  private buildRow(index: number): Row {
    const y = this.y + index * 40;

    const swatch = this.scene.add.rectangle(0, 0, 4, 26, Palette.echoPale, 1).setOrigin(0, 0.5);
    const glyph = this.scene.add
      .text(10, -9, '·', {
        fontSize: '13px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0, 0);
    const label = this.scene.add
      .text(24, -9, '', {
        fontSize: '11px',
        color: '#cfe6ef',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0, 0);
    const progress = this.scene.add.graphics();
    progress.setPosition(10, 9);

    const container = this.scene.add.container(this.x, y, [swatch, glyph, label, progress]);
    this.root.add(container);
    return { container, swatch, glyph, label, progress };
  }

  setVisible(visible: boolean): void {
    this.root.setVisible(visible);
  }

  destroy(): void {
    this.root.destroy(true);
  }
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}
