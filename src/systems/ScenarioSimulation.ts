import { Balance } from '../config/balance';
import { ECHO_COLOURS, NAV_CELL_SIZE } from '../config/gameConfig';
import { EventBus } from '../core/EventBus';
import { IdRegistry } from '../core/IdRegistry';
import type {
  EchoCommand,
  EchoCommandType,
  EchoTrack,
  MedalTier,
  PlayerSettings,
  ScenarioDefinition,
  Vec2,
} from '../core/types';
import { getStationDefinition } from '../data/stations';
import { CommandRecorder } from './CommandRecorder';
import { EchoPlaybackSystem } from './EchoPlaybackSystem';
import { FractureAnalysisSystem, type Diagnosis } from './FractureAnalysisSystem';
import { InteractionSlotSystem } from './InteractionSlotSystem';
import { NavigationSystem } from './NavigationSystem';
import { ObjectiveSystem, type ObjectiveState } from './ObjectiveSystem';
import { ProductionSystem } from './ProductionSystem';
import { TaskSystem } from './TaskSystem';
import { ThreatDirector } from './ThreatDirector';
import { createActor, createBaselineWorld, type SimActor, type SimStation, type SimWorld } from './world';

export type LoopEndReason = 'TIMER' | 'OBJECTIVE_IMPOSSIBLE' | 'ABORTED';

export interface LoopResult {
  reason: LoopEndReason;
  success: boolean;
  medal: MedalTier | null;
  diagnosis: Diagnosis | null;
  objectives: readonly ObjectiveState[];
  runNumber: number;
  echoCount: number;
  /** True for the opening runs the tutorial keeps free of threats. */
  quiet: boolean;
}

export interface TapResolution {
  type: EchoCommandType;
  targetId?: string;
  point?: Vec2;
  itemDefinitionId?: string;
  /** Human-readable verb for the "what will happen" pip. */
  label: string;
}

/**
 * Owns one scenario attempt end to end: world state, all rule systems, the
 * live recording and every replayed track.
 *
 * Deliberately free of Phaser imports. The scene renders from `world` and
 * subscribes to `bus`; it never mutates simulation state directly. That
 * separation is what lets the batch validation test run a hundred replays in
 * Node and compare the results tick for tick.
 */
export class ScenarioSimulation {
  readonly bus = new EventBus();
  readonly ids = new IdRegistry();
  readonly nav: NavigationSystem;
  readonly slots = new InteractionSlotSystem();
  readonly production: ProductionSystem;
  readonly tasks: TaskSystem;
  readonly playback: EchoPlaybackSystem;
  readonly objectives: ObjectiveSystem;
  readonly threats: ThreatDirector;
  readonly recorder: CommandRecorder;
  private readonly analysis = new FractureAnalysisSystem();

  private world: SimWorld;
  private tracks: EchoTrack[] = [];
  private warden: SimActor;
  private liveCommand: EchoCommand | null = null;
  private result: LoopResult | null = null;
  private runNumber = 0;

  constructor(
    readonly scenario: ScenarioDefinition,
    settings: PlayerSettings,
    /** Once completed, tutorial quiet runs no longer apply. */
    private readonly previouslyCompleted = false,
  ) {
    this.nav = new NavigationSystem(scenario.navGrid);
    this.production = new ProductionSystem(this.bus, scenario.id);
    this.tasks = new TaskSystem(this.bus, scenario.id, this.nav, this.slots, this.production, settings);
    this.playback = new EchoPlaybackSystem(this.tasks);
    this.objectives = new ObjectiveSystem(this.bus, scenario);
    this.threats = new ThreatDirector(this.bus, scenario, this.production, settings);
    this.recorder = new CommandRecorder(this.ids, scenario.id);

    this.world = createBaselineWorld(scenario, 0, this.isQuietRun(0));
    this.warden = this.spawnWarden();
  }

  // --- Accessors -----------------------------------------------------------

  getWorld(): SimWorld {
    return this.world;
  }

  getWarden(): SimActor {
    return this.warden;
  }

  getTracks(): readonly EchoTrack[] {
    return this.tracks;
  }

  getResult(): LoopResult | null {
    return this.result;
  }

  get currentRunNumber(): number {
    return this.runNumber;
  }

  get isFinished(): boolean {
    return this.world.finished;
  }

  get remainingTicks(): number {
    return Math.max(0, this.scenario.durationTicks - this.world.tick);
  }

  setSettings(settings: PlayerSettings): void {
    this.tasks.setSettings(settings);
    this.threats.setSettings(settings);
  }

  private isQuietRun(runNumber: number): boolean {
    if (this.previouslyCompleted) return false;
    return runNumber < (this.scenario.tutorialQuietRuns ?? 0);
  }

  // --- Run lifecycle -------------------------------------------------------

  /**
   * Resets the world to baseline and starts a new attempt, replaying every
   * kept track alongside a freshly controlled Warden.
   */
  startRun(tracks: EchoTrack[] = this.tracks): void {
    this.tracks = tracks;
    this.result = null;
    this.liveCommand = null;

    // Reset every system before any of them can observe stale state.
    //
    // The ID registry is deliberately NOT reset: track and command IDs have to
    // stay unique for the whole attempt. Resetting it made a second recording
    // reuse the first track's ID, which collapsed both Echoes onto one actor.
    this.bus.clearJournal();
    this.playback.reset();
    this.threats.reset();
    this.world = createBaselineWorld(this.scenario, this.runNumber, this.isQuietRun(this.runNumber));
    this.objectives.reset(this.tracks.length);

    this.warden = this.spawnWarden();
    this.tracks.forEach((track, index) => this.spawnEcho(track, index));

    this.recorder.start();
    this.bus.emit(
      'LOOP_STARTED',
      { tick: 0, scenarioId: this.scenario.id, sourceId: 'simulation' },
      { runNumber: this.runNumber, echoCount: this.tracks.length },
    );
  }

  private spawnWarden(): SimActor {
    const actor = createActor(
      'warden',
      'WARDEN',
      this.scenario.wardenSpawn,
      Balance.actor.wardenSpeed,
      0,
    );
    this.world.actors.set(actor.id, actor);
    return actor;
  }

  private spawnEcho(track: EchoTrack, index: number): SimActor {
    const actor = createActor(
      // Indexed as well as track-scoped, so two tracks can never share a body.
      `echo-${index}-${track.id}`,
      'ECHO',
      this.scenario.wardenSpawn,
      Balance.actor.echoSpeed,
      track.colourIndex % ECHO_COLOURS.length,
      track.id,
      track.label ?? null,
    );
    this.world.actors.set(actor.id, actor);
    this.playback.register(track, actor.id);
    return actor;
  }

  // --- Simulation ----------------------------------------------------------

  /** Advances exactly one authoritative tick. */
  step(): void {
    if (this.world.finished) return;

    this.world.tick += 1;

    // Order matters: threats move before actors so an interruption lands on
    // the same tick the blow does, then objectives read the settled world.
    this.threats.update(this.world);
    this.playback.update(this.world);
    this.updateWarden();
    this.production.update(this.world);
    this.objectives.update(this.world);

    this.recorder.sample(this.world.tick, this.warden);

    // Ten- and five-second warnings; the music layers react to these.
    const remaining = this.scenario.durationTicks - this.world.tick;
    if (remaining === 300 || remaining === 150) {
      this.bus.emit(
        'LOOP_TICK_WARNING',
        { tick: this.world.tick, scenarioId: this.scenario.id, sourceId: 'simulation' },
        { remainingSeconds: Math.round(remaining / 30) },
      );
    }

    if (this.world.tick >= this.scenario.durationTicks) {
      this.endRun('TIMER');
      return;
    }
    if (this.objectives.claimImpossibleAnnouncement()) {
      this.endRun('OBJECTIVE_IMPOSSIBLE');
    }
  }

  private updateWarden(): void {
    const task = this.warden.task;
    const wasRunning = task !== null && task.state !== 'COMPLETE' && task.state !== 'FAILED';

    this.tasks.update(this.world, this.warden, this.liveCommand);

    const now = this.warden.task;
    if (wasRunning && now && (now.state === 'COMPLETE' || now.state === 'FAILED')) {
      // Command ended by itself; nothing to truncate on replay.
      this.recorder.noteCommandFinished(this.world.tick);
      this.liveCommand = null;
    }
  }

  endRun(reason: LoopEndReason): LoopResult {
    if (this.result) return this.result;

    this.world.finished = true;
    this.recorder.stop();
    // Give the objectives one final read now that `finished` is true, so
    // "survives to sixty seconds" can actually resolve.
    this.objectives.update(this.world);

    const success = reason !== 'ABORTED' && this.objectives.isSuccess();
    const medal = success ? this.objectives.awardedMedal() : null;

    this.bus.emit(
      'LOOP_ENDED',
      { tick: this.world.tick, scenarioId: this.scenario.id, sourceId: 'simulation' },
      { reason, success },
    );

    if (success) {
      this.bus.emit(
        'SCENARIO_STABILISED',
        { tick: this.world.tick, scenarioId: this.scenario.id, sourceId: 'simulation' },
        { medal: medal ?? 'BRONZE', echoCount: this.tracks.length },
      );
    }

    this.result = {
      reason,
      success,
      medal,
      diagnosis: this.analysis.analyse(this.bus.getJournal(), success, this.world.quietRun),
      objectives: this.objectives.objectiveStates,
      runNumber: this.runNumber,
      echoCount: this.tracks.length,
      quiet: this.world.quietRun,
    };
    return this.result;
  }

  // --- Track management ----------------------------------------------------

  /** Seals the run just played into a track the next attempt will replay. */
  buildTrackFromRecording(label?: string): EchoTrack {
    return this.recorder.build(
      this.world.tick,
      this.tracks.length,
      this.runNumber,
      label,
    );
  }

  get recordedCommandCount(): number {
    return this.recorder.commandCount;
  }

  /** Keep every track and add the run just played. */
  keepRecording(label?: string): void {
    if (this.tracks.length >= this.scenario.maxEchoTracks) return;
    this.tracks = [...this.tracks, this.buildTrackFromRecording(label)];
  }

  /** Replace one existing track with the run just played. */
  overwriteTrack(slotIndex: number, label?: string): void {
    const replacement = this.buildTrackFromRecording(label);
    replacement.slotIndex = slotIndex;
    replacement.colourIndex = slotIndex % ECHO_COLOURS.length;
    this.tracks = this.tracks.map((track, index) => (index === slotIndex ? replacement : track));
  }

  discardRecording(): void {
    // Nothing to do - the recorder is rebuilt on the next startRun.
  }

  renameTrack(slotIndex: number, label: string): void {
    const track = this.tracks[slotIndex];
    if (track) track.label = label.slice(0, 12);
  }

  /** Recall: shift a whole track by up to three seconds. */
  offsetTrack(slotIndex: number, offsetTicks: number): void {
    const track = this.tracks[slotIndex];
    if (!track) return;
    const limit = 90;
    track.offsetTicks = Math.max(-limit, Math.min(limit, Math.round(offsetTicks)));
  }

  removeTrack(slotIndex: number): void {
    this.tracks = this.tracks
      .filter((_, index) => index !== slotIndex)
      .map((track, index) => ({ ...track, slotIndex: index, colourIndex: index % ECHO_COLOURS.length }));
  }

  setTracks(tracks: EchoTrack[]): void {
    this.tracks = tracks;
  }

  advanceRunNumber(): void {
    this.runNumber += 1;
  }

  // --- Player input --------------------------------------------------------

  /**
   * Turns a tap into the command the player meant.
   *
   * The scheme is intentionally semantic rather than positional: tapping the
   * bench means "do the sensible thing with the bench", which is what makes a
   * recording survive a slightly different world on replay.
   */
  resolveTap(point: Vec2): TapResolution | null {
    const station = this.stationAt(point);
    if (station) {
      const action = this.production.resolveDefaultAction(this.world, station, this.warden);
      if (!action) {
        // Tapping a station that has nothing to offer still walks you there,
        // which reads as responsive rather than broken.
        return { type: 'MOVE_TO', point: this.nav.snap(point) ?? point, label: 'Move' };
      }
      const resolution: TapResolution = {
        type: action,
        targetId: station.id,
        label: this.labelFor(action),
      };
      if (action === 'TAKE') {
        const item = this.production.nextTakeableItem(station);
        if (item) resolution.itemDefinitionId = item;
      }
      return resolution;
    }

    const snapped = this.nav.snap(point);
    if (!snapped) return null;
    return { type: 'MOVE_TO', point: snapped, label: 'Move' };
  }

  private labelFor(action: EchoCommandType): string {
    switch (action) {
      case 'TAKE':
        return 'Take';
      case 'DELIVER':
        return 'Deliver';
      case 'WORK':
        return 'Work';
      case 'OPERATE':
        return 'Fire';
      case 'SIGNAL':
        return 'Ring';
      default:
        return 'Move';
    }
  }

  /**
   * Station whose body the tap landed on, if any.
   *
   * Tested against the station's actual footprint plus a thumb-sized margin
   * rather than a fixed radius around its centre: the gate is four cells wide,
   * and a circular test made its ends effectively untappable.
   */
  stationAt(point: Vec2, margin = 18): SimStation | undefined {
    let best: SimStation | undefined;
    let bestDistance = Infinity;

    for (const station of this.world.stations.values()) {
      const definition = getStationDefinition(station.definitionId);
      const footprint = definition.footprint ?? { width: 2, height: 2 };
      const halfWidth = (footprint.width * NAV_CELL_SIZE) / 2 + margin;
      const halfHeight = (footprint.height * NAV_CELL_SIZE) / 2 + margin;

      const dx = Math.abs(point.x - station.position.x) - halfWidth;
      const dy = Math.abs(point.y - station.position.y) - halfHeight;
      if (dx > 0 || dy > 0) continue;

      // Inside more than one? Take the nearest centre, deterministically.
      const distance = Math.hypot(point.x - station.position.x, point.y - station.position.y);
      if (distance < bestDistance - 1e-9) {
        bestDistance = distance;
        best = station;
      }
    }
    return best;
  }

  /** Issues a resolved command to the live Warden and records it. */
  issue(resolution: TapResolution): EchoCommand | null {
    if (this.world.finished) return null;

    const options: Parameters<CommandRecorder['record']>[2] = {};
    if (resolution.targetId !== undefined) options.targetId = resolution.targetId;
    if (resolution.itemDefinitionId !== undefined) options.itemDefinitionId = resolution.itemDefinitionId;
    if (resolution.point !== undefined) options.point = resolution.point;

    const command = this.recorder.record(this.world.tick, resolution.type, options);
    if (!command) return null;

    this.liveCommand = command;
    this.tasks.begin(this.world, this.warden, command);
    return command;
  }

  /** Convenience used by tests and the developer bridge. */
  issueAt(point: Vec2): EchoCommand | null {
    const resolution = this.resolveTap(point);
    return resolution ? this.issue(resolution) : null;
  }

  getLiveCommand(): EchoCommand | null {
    return this.liveCommand;
  }

  /** Frees listeners, reservations and pooled state. */
  dispose(): void {
    this.slots.releaseAll(this.world, this.warden.id);
    for (const actor of this.world.actors.values()) this.slots.releaseAll(this.world, actor.id);
    this.world.actors.clear();
    this.world.enemies.clear();
    this.world.projectiles = [];
    this.world.telegraphs = [];
    this.playback.reset();
    this.bus.dispose();
    this.ids.reset();
  }
}
