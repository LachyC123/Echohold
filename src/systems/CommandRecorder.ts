import { Balance } from '../config/balance';
import { ECHO_COLOURS } from '../config/gameConfig';
import type { EchoCommand, EchoCommandType, EchoTrack, PathSample, Vec2 } from '../core/types';
import type { IdRegistry } from '../core/IdRegistry';
import type { SimActor } from './world';

/** How often the live route is sampled for the replay's visual shape. */
const PATH_SAMPLE_INTERVAL_TICKS = 3;

/**
 * Records the live Warden's run as timed semantic intentions.
 *
 * Raw pointer input is never the source of truth (design document section
 * 7.2). Path samples are kept only so a replayed route traces the same shape
 * the player drew; if the world has shifted, the Echo re-paths to the stable
 * target ID instead of walking into a wall.
 */
export class CommandRecorder {
  private commands: EchoCommand[] = [];
  private active: { command: EchoCommand; startTick: number } | null = null;
  private samples: PathSample[] = [];
  private recording = false;

  constructor(
    private readonly ids: IdRegistry,
    private readonly scenarioId: string,
  ) {}

  start(): void {
    this.commands = [];
    this.active = null;
    this.samples = [];
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
    this.active = null;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get commandCount(): number {
    return this.commands.length;
  }

  /**
   * Records a newly issued command. If one was already running it is closed
   * out with the elapsed time, so playback can reproduce the interruption.
   */
  record(
    tick: number,
    type: EchoCommandType,
    options: {
      targetId?: string;
      itemDefinitionId?: string;
      point?: Vec2;
      requestedDurationTicks?: number;
      critical?: boolean;
    } = {},
  ): EchoCommand | null {
    if (!this.recording) return null;

    this.closeActive(tick, true);

    const command: EchoCommand = {
      id: this.ids.next('cmd'),
      type,
      issuedTick: tick,
      fallback: type === 'MOVE_TO' ? 'SKIP' : 'RETRY_UNTIL_TIMEOUT',
      timeoutTicks: Balance.commands.defaultTimeoutTicks,
      ...(options.targetId !== undefined ? { targetId: options.targetId } : {}),
      ...(options.itemDefinitionId !== undefined ? { itemDefinitionId: options.itemDefinitionId } : {}),
      ...(options.point !== undefined ? { point: { x: options.point.x, y: options.point.y } } : {}),
      ...(options.requestedDurationTicks !== undefined
        ? { requestedDurationTicks: options.requestedDurationTicks }
        : {}),
      ...(options.critical !== undefined ? { critical: options.critical } : {}),
    };

    this.commands.push(command);
    this.active = { command, startTick: tick };
    this.samples = [];
    return command;
  }

  /** Called when the live task ends on its own; no interruption is stored. */
  noteCommandFinished(tick: number): void {
    this.closeActive(tick, false);
  }

  private closeActive(tick: number, interrupted: boolean): void {
    if (!this.active) return;
    const { command, startTick } = this.active;
    if (interrupted) {
      // Anything under a tick is a double-tap, not a change of mind.
      const elapsed = Math.max(1, tick - startTick);
      command.maxRunTicks = elapsed;
    }
    if (this.samples.length > 1) command.pathSamples = this.samples;
    this.active = null;
    this.samples = [];
  }

  /** Called every tick while recording, to trace the live route. */
  sample(tick: number, actor: SimActor): void {
    if (!this.recording || !this.active) return;
    if (tick % PATH_SAMPLE_INTERVAL_TICKS !== 0) return;
    this.samples.push({ tick, x: Math.round(actor.position.x), y: Math.round(actor.position.y) });
    // Bound the memory: a 60s loop can never store more than a few hundred.
    if (this.samples.length > 220) this.samples.shift();
  }

  /** Seals the recording into a track ready to be replayed. */
  build(endTick: number, slotIndex: number, runNumber: number, label?: string): EchoTrack {
    this.closeActive(endTick, false);
    return {
      id: this.ids.next('track'),
      scenarioId: this.scenarioId,
      slotIndex,
      colourIndex: slotIndex % ECHO_COLOURS.length,
      commands: this.commands.map((c) => ({ ...c })),
      durationTicks: endTick,
      createdAtRunNumber: runNumber,
      ...(label !== undefined ? { label } : {}),
    };
  }

  /** Read-only view for the live timeline strip. */
  peek(): readonly EchoCommand[] {
    return this.commands;
  }
}
