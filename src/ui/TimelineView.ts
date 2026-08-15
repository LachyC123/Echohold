import Phaser from 'phaser';
import { Depth, ECHO_COLOURS, Palette, TICKS_PER_SECOND } from '../config/gameConfig';
import type { DomainEvent } from '../core/events';
import { selectEvents } from '../core/events';
import type { EchoCommand, EchoCommandType, EchoTrack } from '../core/types';

const VERB_GLYPH: Record<EchoCommandType, string> = {
  MOVE_TO: '»',
  TAKE: '↑',
  DELIVER: '↓',
  WORK: '⚒',
  OPERATE: '➤',
  WAIT: '‖',
  SIGNAL: '◉',
  DODGE: '~',
};

export interface TimelineSelection {
  tick: number;
  cause: string;
  focusTargetId?: string;
}

/**
 * The 0-60 second review strip, one row per Echo (design document section 18).
 *
 * Command blocks show intended time; the bar is drawn from the actual start
 * and completion recorded in the event journal, waiting appears as hatching,
 * and a fracture appears as a red-cyan crack. Selecting any block reports the
 * one plain-language cause behind it.
 */
export class TimelineView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly hitAreas: Phaser.GameObjects.Rectangle[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private playhead: Phaser.GameObjects.Rectangle;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly width: number,
    private readonly durationTicks: number,
    private readonly onSelect: (selection: TimelineSelection) => void,
  ) {
    this.graphics = scene.add.graphics();
    this.playhead = scene.add.rectangle(x, y, 2, 10, Palette.parchment, 0.9).setOrigin(0, 0);
    this.root = scene.add.container(0, 0, [this.graphics, this.playhead]).setDepth(Depth.overlay + 1);
  }

  /**
   * @param liveCommands the run just played, drawn as the bottom row
   */
  render(tracks: readonly EchoTrack[], liveCommands: readonly EchoCommand[], journal: readonly DomainEvent[]): void {
    this.graphics.clear();
    for (const area of this.hitAreas) area.destroy();
    for (const label of this.labels) label.destroy();
    this.hitAreas.length = 0;
    this.labels.length = 0;

    this.drawAxis();

    const rows: Array<{ commands: readonly EchoCommand[]; colour: number; name: string; actorId: string }> = [];
    tracks.forEach((track, index) => {
      rows.push({
        commands: track.commands,
        colour: ECHO_COLOURS[track.colourIndex % ECHO_COLOURS.length] ?? Palette.echoPale,
        name: track.label ?? `Echo ${index + 1}`,
        actorId: `echo-${index}-${track.id}`,
      });
    });
    rows.push({ commands: liveCommands, colour: Palette.wardenCream, name: 'Warden', actorId: 'warden' });

    rows.forEach((row, index) => {
      const rowY = this.y + 24 + index * 30;
      this.drawRowLabel(row.name, rowY, row.colour);
      for (const command of row.commands) {
        this.drawCommand(command, rowY, row.colour, row.actorId, journal);
      }
    });
  }

  private drawAxis(): void {
    this.graphics.fillStyle(Palette.stoneDark, 0.8);
    this.graphics.fillRect(this.x, this.y + 12, this.width, 1);

    for (let second = 0; second <= 60; second += 10) {
      const tickX = this.x + (second / 60) * this.width;
      this.graphics.fillStyle(Palette.stoneBase, 1);
      this.graphics.fillRect(tickX, this.y + 6, 1, 7);
      const label = this.scene.add
        .text(tickX, this.y - 6, `${second}`, {
          fontSize: '9px',
          color: '#647b91',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(0.5, 0)
        .setDepth(Depth.overlay + 2);
      this.labels.push(label);
    }
  }

  private drawRowLabel(name: string, y: number, colour: number): void {
    const label = this.scene.add
      .text(this.x - 8, y + 5, name, {
        fontSize: '10px',
        color: `#${colour.toString(16).padStart(6, '0')}`,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(1, 0.5)
      .setDepth(Depth.overlay + 2);
    this.labels.push(label);
  }

  private xForTick(tick: number): number {
    return this.x + (Math.max(0, Math.min(tick, this.durationTicks)) / this.durationTicks) * this.width;
  }

  private drawCommand(
    command: EchoCommand,
    y: number,
    colour: number,
    actorId: string,
    journal: readonly DomainEvent[],
  ): void {
    const started = selectEvents(journal, 'COMMAND_STARTED').find(
      (e) => e.payload.commandId === command.id && e.payload.actorId === actorId,
    );
    const completed = selectEvents(journal, 'COMMAND_COMPLETED').find(
      (e) => e.payload.commandId === command.id && e.payload.actorId === actorId,
    );
    const failed = selectEvents(journal, 'COMMAND_FAILED').find(
      (e) => e.payload.commandId === command.id && e.payload.actorId === actorId,
    );
    const waiting = selectEvents(journal, 'COMMAND_WAITING').find(
      (e) => e.payload.commandId === command.id && e.payload.actorId === actorId,
    );

    const startTick = started?.tick ?? command.issuedTick;
    const endTick = completed?.tick ?? failed?.tick ?? this.durationTicks;
    const left = this.xForTick(startTick);
    const right = Math.max(left + 8, this.xForTick(endTick));

    // The block itself: solid for work actually done.
    this.graphics.fillStyle(colour, failed ? 0.35 : 0.8);
    this.graphics.fillRoundedRect(left, y, right - left, 14, 3);

    // Waiting is hatched, so a stalled Echo is visibly different from a busy one.
    if (waiting) {
      const waitLeft = this.xForTick(waiting.tick);
      this.graphics.lineStyle(1, Palette.blockedRust, 0.9);
      for (let hx = waitLeft; hx < right; hx += 4) {
        this.graphics.lineBetween(hx, y, hx - 6, y + 14);
      }
    }

    // Fractures crack in red and cyan.
    if (failed) {
      const fx = this.xForTick(failed.tick);
      this.graphics.lineStyle(2, Palette.danger, 1);
      this.graphics.lineBetween(fx - 4, y - 2, fx + 3, y + 8);
      this.graphics.lineStyle(2, Palette.timeTeal, 1);
      this.graphics.lineBetween(fx + 3, y + 8, fx - 3, y + 16);
    }

    // Intended time marker, so drift against the plan is visible.
    const intendedX = this.xForTick(command.issuedTick);
    this.graphics.fillStyle(Palette.parchment, 0.55);
    this.graphics.fillRect(intendedX, y - 4, 1, 4);

    const glyph = this.scene.add
      .text(left + 3, y + 7, VERB_GLYPH[command.type], {
        fontSize: '9px',
        color: '#141a22',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0, 0.5)
      .setDepth(Depth.overlay + 2);
    this.labels.push(glyph);

    const hit = this.scene.add
      .rectangle(left, y - 4, Math.max(22, right - left), 22, 0x000000, 0)
      .setOrigin(0, 0)
      .setDepth(Depth.overlay + 3)
      .setInteractive({ useHandCursor: true });

    hit.on('pointerup', () => {
      this.onSelect({
        tick: failed?.tick ?? startTick,
        cause: this.causeFor(command, { started, completed, failed, waiting }),
        ...(command.targetId !== undefined ? { focusTargetId: command.targetId } : {}),
      });
    });
    this.hitAreas.push(hit);
  }

  /** One plain-language sentence per selected event. */
  private causeFor(
    command: EchoCommand,
    events: {
      started?: DomainEvent<'COMMAND_STARTED'>;
      completed?: DomainEvent<'COMMAND_COMPLETED'>;
      failed?: DomainEvent<'COMMAND_FAILED'>;
      waiting?: DomainEvent<'COMMAND_WAITING'>;
    },
  ): string {
    const s = (tick: number) => (tick / TICKS_PER_SECOND).toFixed(1);
    const verb = command.type.toLowerCase().replace('_', ' ');

    if (events.failed) {
      const waited = events.waiting ? ` after waiting ${s(events.failed.tick - events.waiting.tick)}s` : '';
      return `${verb} failed at ${s(events.failed.tick)}s${waited}: ${events.failed.payload.reason
        .toLowerCase()
        .replace(/_/g, ' ')}.`;
    }
    if (events.completed && events.started) {
      const drift = events.started.tick - command.issuedTick;
      const driftText = drift > 3 ? `, ${s(drift)}s later than planned` : '';
      return `${verb} ran from ${s(events.started.tick)}s to ${s(events.completed.tick)}s${driftText}.`;
    }
    return `${verb} was issued at ${s(command.issuedTick)}s and never finished.`;
  }

  setPlayhead(tick: number, rowCount: number): void {
    this.playhead
      .setPosition(this.xForTick(tick), this.y + 16)
      .setSize(2, 24 + rowCount * 30)
      .setVisible(true);
  }

  destroy(): void {
    for (const area of this.hitAreas) area.destroy();
    for (const label of this.labels) label.destroy();
    this.root.destroy(true);
  }
}
