import Phaser from 'phaser';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { Balance } from '../config/balance';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  Depth,
  IS_DEV,
  Palette,
  SceneKeys,
  TICKS_PER_SECOND,
} from '../config/gameConfig';
import { FixedStepClock } from '../core/FixedStepClock';
import type { ScenarioDefinition, Vec2 } from '../core/types';
import { BROKEN_GATE } from '../data/scenarios/brokenGate';
import { getEnemyDefinition } from '../data/enemies';
import { ActorView } from '../entities/ActorView';
import { EnemyView } from '../entities/EnemyView';
import { StationView } from '../entities/StationView';
import type { DevSnapshot } from '../dev/devBridge';
import { FeedbackSystem } from '../systems/FeedbackSystem';
import { ScenarioSimulation, type LoopResult } from '../systems/ScenarioSimulation';
import { TutorialSystem } from '../systems/TutorialSystem';

/**
 * Reserved for the HUD: the timer band at the top and the carried-item and
 * tutorial band at the bottom. The courtyard is framed inside what is left.
 */
const HUD_TOP_BAND = 104;
const HUD_BOTTOM_BAND = 150;

/** Closer level for the restrained two-step pinch (design document section 8). */
const ZOOM_CLOSE_FACTOR = 1.35;

const TAP_MOVEMENT_THRESHOLD = 14;
const LONG_PRESS_MS = 420;

/**
 * The playable scenario: world rendering, camera, touch input and the loop.
 *
 * The scene owns no rules. It advances {@link ScenarioSimulation} on a fixed
 * step, draws whatever the simulation says is true, and turns pointer events
 * into semantic commands. The HUD lives in {@link SceneKeys.UI}, running in
 * parallel so a pause overlay never has to fight the world camera.
 */
export class ScenarioScene extends Phaser.Scene {
  simulation!: ScenarioSimulation;
  tutorial!: TutorialSystem;
  private context!: GameContext;
  private clock = new FixedStepClock();
  private feedback!: FeedbackSystem;

  private scenario: ScenarioDefinition = BROKEN_GATE;
  private actorViews = new Map<string, ActorView>();
  private stationViews = new Map<string, StationView>();
  private enemyViews = new Map<string, EnemyView>();
  private telegraphMarkers: Phaser.GameObjects.Image[] = [];
  private projectileGraphics!: Phaser.GameObjects.Graphics;
  private destinationPip!: Phaser.GameObjects.Image;
  private highlightRing!: Phaser.GameObjects.Arc;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;

  private paused = false;
  private awaitingResume = false;
  private pointerDownAt: { x: number; y: number; time: number } | null = null;
  private longPressTimer: Phaser.Time.TimerEvent | null = null;
  private pinchStartDistance: number | null = null;
  private zoomWide = 0.8;
  private zoomClose = 1.05;

  constructor() {
    super(SceneKeys.Scenario);
  }

  init(data: { scenarioId?: string }): void {
    this.scenario = data.scenarioId === BROKEN_GATE.id ? BROKEN_GATE : BROKEN_GATE;
  }

  create(): void {
    this.context = this.game.registry.get(CONTEXT_KEY) as GameContext;

    this.simulation = new ScenarioSimulation(
      this.scenario,
      this.context.settings,
      this.context.hasCompleted(this.scenario.id),
    );
    this.tutorial = new TutorialSystem(
      this.simulation.bus,
      this.scenario,
      !this.context.hasCompleted(this.scenario.id),
    );

    this.feedback = new FeedbackSystem(
      this,
      this.simulation.bus,
      this.context.audio,
      this.context.quality,
      () => this.simulation.getWorld(),
      this.context.settings,
    );

    this.paintGround();
    this.projectileGraphics = this.add.graphics().setDepth(Depth.effect);
    this.destinationPip = this.add.image(-100, -100, 'destination-pip').setDepth(Depth.pathOverlay).setVisible(false);
    this.highlightRing = this.add
      .circle(-100, -100, 34)
      .setStrokeStyle(3, Palette.readyGold, 0.9)
      .setDepth(Depth.telegraph)
      .setVisible(false);

    this.setupCamera();
    this.setupInput();

    this.scene.launch(SceneKeys.UI, { scenario: this });
    this.beginRun();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.game.events.on('echohold:hidden', this.onHidden, this);
    this.game.events.on('echohold:visible', this.onVisible, this);

    if (IS_DEV) this.setupDebugOverlay();
  }

  // --- Run lifecycle -------------------------------------------------------

  /** Starts (or restarts) an attempt from the scenario baseline. */
  beginRun(): void {
    this.clearViews();
    this.simulation.startRun();
    this.tutorial.beginRun(this.simulation.currentRunNumber);
    this.clock.reset();
    this.paused = false;
    this.awaitingResume = false;

    this.context.audio.stopLoopMusic();
    this.context.audio.startLoopMusic(this.simulation.getTracks().length);
    this.buildViews();
    this.events.emit('run-started');
  }

  /** Keeps the recording as a new Echo, then starts the next attempt. */
  keepAndRetry(label?: string): void {
    if (this.simulation.getTracks().length < this.scenario.maxEchoTracks) {
      this.simulation.keepRecording(label);
    }
    this.simulation.advanceRunNumber();
    this.beginRun();
  }

  /** Replaces one existing Echo with the recording just played. */
  overwriteAndRetry(slotIndex: number): void {
    this.simulation.overwriteTrack(slotIndex);
    this.simulation.advanceRunNumber();
    this.beginRun();
  }

  /** Throws the recording away and tries the same plan again. */
  discardAndRetry(): void {
    this.simulation.discardRecording();
    this.simulation.advanceRunNumber();
    this.beginRun();
  }

  /** Restart within two taps: abandon the recording and go again immediately. */
  restartImmediately(): void {
    if (!this.simulation.isFinished) this.simulation.endRun('ABORTED');
    this.discardAndRetry();
  }

  returnToHub(): void {
    this.context.audio.stopLoopMusic();
    this.cameras.main.fadeOut(180, 12, 18, 26);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop(SceneKeys.UI);
      this.scene.start(SceneKeys.Hub);
    });
  }

  /** Used by the development bridge only. */
  abandonToHub(): void {
    this.returnToHub();
  }

  // --- Update loop ---------------------------------------------------------

  override update(_time: number, delta: number): void {
    const holding = this.paused || this.awaitingResume || this.tutorial.shouldHoldTimer;
    this.clock.setPaused(holding);

    if (!holding && !this.simulation.isFinished) {
      const scale = this.context.settings.slowSimulation ? Balance.assists.slowSimulationRate : 1;
      this.clock.advance(delta * scale, () => {
        this.simulation.step();
        if (this.simulation.isFinished) this.onLoopEnded(this.simulation.getResult());
      });
    }

    this.syncViews(delta);
    this.updateCamera(delta);

    if (this.context.quality.sample(delta)) this.applyQuality();
    if (this.debugGraphics) this.drawDebug();
  }

  private onLoopEnded(result: LoopResult | null): void {
    if (!result) return;
    this.context.audio.stopLoopMusic();
    this.events.emit('loop-ended', result);
  }

  // --- World construction --------------------------------------------------

  private paintGround(): void {
    const { worldSize, wallRects } = this.scenario;

    this.add
      .tileSprite(0, 0, worldSize.x, worldSize.y, 'ground-tile')
      .setOrigin(0, 0)
      .setDepth(Depth.ground);

    // Only authored masonry is drawn as stone. Station footprints block
    // movement too, but they are furniture and draw themselves.
    const walls = this.add.graphics().setDepth(Depth.ground + 1);
    for (const rect of wallRects) {
      walls.fillStyle(Palette.stoneDark, 1);
      walls.fillRect(rect.x, rect.y, rect.width, rect.height);
      // Courses of masonry, so a wall reads as built rather than as a void.
      // Kept low-contrast: the wall is a frame, not a thing to look at.
      walls.fillStyle(Palette.stoneBase, 0.16);
      let course = 0;
      for (let y = rect.y + 12; y < rect.y + rect.height - 4; y += 24) {
        walls.fillRect(rect.x + 2, y, rect.width - 4, 1);
        // Staggered vertical joints turn stripes into blockwork.
        for (let x = rect.x + (course % 2 === 0 ? 24 : 48); x < rect.x + rect.width - 4; x += 48) {
          walls.fillRect(x, y, 1, 24);
        }
        course += 1;
      }
      // Lit top edge where the wall meets open ground.
      walls.fillStyle(Palette.stoneLight, 0.5);
      walls.fillRect(rect.x, rect.y + rect.height - 4, rect.width, 4);
    }

    // One warm key light from the sunset, cool ambient in the shadowed north.
    // Kept low-contrast: clarity on a phone beats atmosphere.
    const light = this.add.graphics().setDepth(Depth.groundDecal);
    light.fillStyle(Palette.timeViolet, 0.16);
    light.fillRect(0, 0, worldSize.x, 190);
    light.fillStyle(Palette.readyGold, 0.03);
    light.fillRect(0, 190, worldSize.x, worldSize.y - 190);
  }

  private buildViews(): void {
    const world = this.simulation.getWorld();
    const reduceMotion = this.context.settings.reduceMotion;

    for (const station of world.stations.values()) {
      this.stationViews.set(station.id, new StationView(this, station, this.context.settings.highContrast));
    }
    for (const actor of world.actors.values()) {
      this.actorViews.set(actor.id, new ActorView(this, actor, reduceMotion));
    }
  }

  private clearViews(): void {
    for (const view of this.actorViews.values()) view.destroy();
    for (const view of this.stationViews.values()) view.destroy();
    for (const view of this.enemyViews.values()) view.destroy();
    for (const marker of this.telegraphMarkers) marker.destroy();
    this.actorViews.clear();
    this.stationViews.clear();
    this.enemyViews.clear();
    this.telegraphMarkers = [];
    this.projectileGraphics?.clear();
    this.destinationPip?.setVisible(false);
    this.highlightRing?.setVisible(false);
  }

  // --- Rendering -----------------------------------------------------------

  private syncViews(delta: number): void {
    const world = this.simulation.getWorld();
    const warden = this.simulation.getWarden();

    for (const [id, view] of this.stationViews) {
      const station = world.stations.get(id);
      if (!station) continue;
      const action = this.simulation.production.resolveDefaultAction(world, station, warden);
      view.sync(station, action !== null && !this.simulation.isFinished);
    }

    for (const [id, view] of this.actorViews) {
      const actor = world.actors.get(id);
      if (!actor) {
        view.destroy();
        this.actorViews.delete(id);
        continue;
      }
      view.sync(actor, delta);
    }

    for (const enemy of world.enemies.values()) {
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = new EnemyView(this, enemy, this.context.settings.reduceMotion);
        this.enemyViews.set(enemy.id, view);
      }
      view.sync(enemy, world.tick, delta);
    }
    for (const [id, view] of this.enemyViews) {
      if (!world.enemies.has(id)) {
        view.destroy();
        this.enemyViews.delete(id);
      }
    }

    this.syncTelegraphs();
    this.syncProjectiles();
    this.syncDestinationPip();
    this.syncTutorialHighlight();
  }

  /** Threat markers appear on the lane before the enemy does. */
  private syncTelegraphs(): void {
    const world = this.simulation.getWorld();
    while (this.telegraphMarkers.length < world.telegraphs.length) {
      this.telegraphMarkers.push(this.add.image(0, 0, 'threat-marker').setDepth(Depth.telegraph));
    }
    this.telegraphMarkers.forEach((marker, index) => {
      const telegraph = world.telegraphs[index];
      if (!telegraph) {
        marker.setVisible(false);
        return;
      }
      const lane = this.scenario.lanes.find((l) => l.id === telegraph.laneId);
      if (!lane) {
        marker.setVisible(false);
        return;
      }
      const definition = getEnemyDefinition(telegraph.enemyDefinitionId);
      marker
        .setVisible(true)
        .setPosition(lane.to.x, lane.to.y - 54)
        .setScale(definition.behaviour === 'RAM_CREW' ? 1.25 : 1)
        .setAlpha(0.55 + Math.sin(world.tick * 0.2) * 0.35);
    });
  }

  private syncProjectiles(): void {
    const world = this.simulation.getWorld();
    this.projectileGraphics.clear();
    for (const projectile of world.projectiles) {
      const x = projectile.from.x + (projectile.to.x - projectile.from.x) * projectile.progress;
      const y = projectile.from.y + (projectile.to.y - projectile.from.y) * projectile.progress;
      // Bolt with a short trail, so the shot reads even on a small screen.
      this.projectileGraphics.lineStyle(3, Palette.parchment, 0.95);
      this.projectileGraphics.beginPath();
      this.projectileGraphics.moveTo(x, y);
      this.projectileGraphics.lineTo(
        x - (projectile.to.x - projectile.from.x) * 0.05,
        y - (projectile.to.y - projectile.from.y) * 0.05,
      );
      this.projectileGraphics.strokePath();
    }
  }

  private syncDestinationPip(): void {
    const warden = this.simulation.getWarden();
    const task = warden.task;
    const moving = task?.state === 'MOVING' && warden.path.length > 0;
    if (!moving) {
      this.destinationPip.setVisible(false);
      return;
    }
    const destination = warden.path[warden.path.length - 1]!;
    this.destinationPip.setVisible(true).setPosition(destination.x, destination.y);
    this.destinationPip.setAlpha(0.5 + Math.sin(this.time.now * 0.006) * 0.3);
  }

  private syncTutorialHighlight(): void {
    const step = this.tutorial.current;
    const targetId = step?.highlightTargetId;
    if (!targetId) {
      this.highlightRing.setVisible(false);
      return;
    }
    const station = this.simulation.getWorld().stations.get(targetId);
    if (!station) {
      this.highlightRing.setVisible(false);
      return;
    }
    // A target highlights before interaction, never after.
    this.highlightRing
      .setVisible(true)
      .setPosition(station.position.x, station.position.y)
      .setRadius(34 + Math.sin(this.time.now * 0.005) * 5);
  }

  // --- Camera --------------------------------------------------------------

  private setupCamera(): void {
    const camera = this.cameras.main;
    const { worldSize } = this.scenario;

    // Fit the whole courtyard into the band the HUD leaves free, so "the
    // entire relevant courtyard fits within one portrait view" holds on a
    // short 16:9 phone as well as a tall one.
    const playHeight = Math.max(240, this.scale.height - HUD_TOP_BAND - HUD_BOTTOM_BAND);
    const fit = Math.min(this.scale.width / worldSize.x, playHeight / worldSize.y);
    this.zoomWide = Phaser.Math.Clamp(fit, 0.55, 1.15);
    this.zoomClose = Math.min(this.zoomWide * ZOOM_CLOSE_FACTOR, 1.6);

    // No camera bounds: this courtyard is smaller than the viewport, and
    // bounds would pin it to the top-left corner rather than centring it.
    camera.setZoom(this.zoomWide);
    const target = this.cameraTarget();
    const scroll = this.scrollFor(target);
    camera.scrollX = scroll.x;
    camera.scrollY = scroll.y;
    camera.fadeIn(240, 12, 18, 26);
  }

  /**
   * Where the camera wants to look: the courtyard centre, nudged by a small
   * follow bias toward the Warden and lifted so the free band between the HUD
   * bands - not the raw canvas centre - is what the world sits in.
   */
  private cameraTarget(): Vec2 {
    const { worldSize } = this.scenario;
    const warden = this.simulation?.getWarden();
    const zoom = this.cameras.main.zoom || this.zoomWide;

    // Screen row the world centre should land on, in design pixels.
    const freeCentre = HUD_TOP_BAND + (this.scale.height - HUD_TOP_BAND - HUD_BOTTOM_BAND) / 2;
    const bias = (freeCentre - this.scale.height / 2) / zoom;

    let x = worldSize.x / 2;
    let y = worldSize.y / 2 - bias;

    if (warden) {
      x += (warden.position.x - worldSize.x / 2) * 0.16;
      y += (warden.position.y - worldSize.y / 2) * 0.16;
    }

    // An arriving threat nudges framing toward its boundary without ever
    // taking control away from the player.
    const world = this.simulation?.getWorld();
    const telegraph = world?.telegraphs[0];
    if (telegraph) {
      const lane = this.scenario.lanes.find((l) => l.id === telegraph.laneId);
      if (lane) {
        x += (lane.to.x - worldSize.x / 2) * 0.1;
        y -= 24;
      }
    }
    return { x, y };
  }

  /**
   * Scroll that puts `target` at the centre of the viewport.
   *
   * Phaser scales about the camera midpoint, so the offset is half the
   * viewport in *unzoomed* units. Dividing by the zoom here - the obvious
   * mistake - pins the world to the right edge at any zoom below one, which
   * is invisible on a tall phone and glaring on a short one.
   */
  private scrollFor(target: Vec2): Vec2 {
    const camera = this.cameras.main;
    return { x: target.x - camera.width / 2, y: target.y - camera.height / 2 };
  }

  private updateCamera(delta: number): void {
    const camera = this.cameras.main;
    const desired = this.scrollFor(this.cameraTarget());
    const lerp = Math.min(1, (delta / 1000) * 2.4);

    camera.scrollX += (desired.x - camera.scrollX) * lerp;
    camera.scrollY += (desired.y - camera.scrollY) * lerp;
  }

  private setZoomLevel(zoom: number): void {
    const camera = this.cameras.main;
    if (Math.abs(camera.zoom - zoom) < 0.01) return;
    this.tweens.add({ targets: camera, zoom, duration: 220, ease: 'Quad.easeOut' });
  }

  // --- Input ---------------------------------------------------------------

  private setupInput(): void {
    this.input.addPointer(2);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      // Two-finger tap pauses, matching the documented control scheme.
      if (this.input.pointer2?.isDown && pointer.id !== this.input.pointer1?.id) {
        this.togglePause();
        return;
      }
      if (this.simulation.isFinished || this.paused) return;

      this.pointerDownAt = { x: pointer.x, y: pointer.y, time: this.time.now };
      this.longPressTimer?.remove();
      this.longPressTimer = this.time.delayedCall(LONG_PRESS_MS, () => this.onLongPress(pointer));
    });

    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      this.longPressTimer?.remove();
      this.longPressTimer = null;
      const start = this.pointerDownAt;
      this.pointerDownAt = null;
      if (!start || this.paused || this.simulation.isFinished) return;

      const travelled = Phaser.Math.Distance.Between(start.x, start.y, pointer.x, pointer.y);
      const elapsed = this.time.now - start.time;

      if (travelled <= TAP_MOVEMENT_THRESHOLD && elapsed < LONG_PRESS_MS) {
        this.handleTap(pointer);
      } else if (travelled > TAP_MOVEMENT_THRESHOLD) {
        // Drag: queue a plain move, without the destination's default action.
        this.handleDragRelease(pointer);
      }
    });

    // Restrained pinch: snaps between two approved levels rather than free
    // zoom, so the courtyard framing stays authored.
    this.input.on(Phaser.Input.Events.POINTER_MOVE, () => {
      const a = this.input.pointer1;
      const b = this.input.pointer2;
      if (!a?.isDown || !b?.isDown) {
        this.pinchStartDistance = null;
        return;
      }
      const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (this.pinchStartDistance === null) {
        this.pinchStartDistance = distance;
        return;
      }
      const ratio = distance / this.pinchStartDistance;
      if (ratio > 1.25) {
        this.setZoomLevel(this.zoomClose);
        this.pinchStartDistance = distance;
      } else if (ratio < 0.8) {
        this.setZoomLevel(this.zoomWide);
        this.pinchStartDistance = distance;
      }
      // A pinch is not a tap.
      this.pointerDownAt = null;
      this.longPressTimer?.remove();
      this.longPressTimer = null;
    });

    // A finger leaving the canvas must not leave a command half-issued.
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, () => {
      this.longPressTimer?.remove();
      this.longPressTimer = null;
      this.pointerDownAt = null;
    });
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      this.pointerDownAt = null;
      this.longPressTimer?.remove();
      this.longPressTimer = null;
    });

    // Desktop development controls.
    this.input.keyboard?.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard?.on('keydown-R', () => this.events.emit('request-restart'));
    this.input.keyboard?.on('keydown-SPACE', () => {
      const warden = this.simulation.getWarden();
      const nearest = this.simulation.stationAt(warden.position, 90);
      if (nearest) this.issueAt({ x: nearest.position.x, y: nearest.position.y });
    });
  }

  private worldPoint(pointer: Phaser.Input.Pointer): Vec2 {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: point.x, y: point.y };
  }

  private handleTap(pointer: Phaser.Input.Pointer): void {
    const step = this.tutorial.current;
    // An acknowledgement panel owns the next tap; the world does not.
    if (step && step.completeOn.kind === 'ACKNOWLEDGED') return;
    this.issueAt(this.worldPoint(pointer));
  }

  private handleDragRelease(pointer: Phaser.Input.Pointer): void {
    const point = this.worldPoint(pointer);
    const snapped = this.simulation.nav.snap(point);
    if (!snapped) return;
    this.simulation.issue({ type: 'MOVE_TO', point: snapped, label: 'Move' });
    this.tutorial.notePlayerCommand();
    this.context.audio.play('ui-tap');
  }

  private issueAt(point: Vec2): void {
    const resolution = this.simulation.resolveTap(point);
    if (!resolution) return;
    this.simulation.issue(resolution);
    // Acting on the instruction releases the tutorial's hold on the clock.
    this.tutorial.notePlayerCommand();
    this.context.audio.play('ui-tap');
    this.events.emit('command-issued', resolution);
  }

  /** Press and hold a station that supports more than one action. */
  private onLongPress(pointer: Phaser.Input.Pointer): void {
    const point = this.worldPoint(pointer);
    const station = this.simulation.stationAt(point);
    if (!station) return;
    this.events.emit('radial-request', { station, screen: { x: pointer.x, y: pointer.y } });
  }

  // --- Pause and lifecycle -------------------------------------------------

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.events.emit('pause-changed', paused);
    if (paused) this.context.audio.stopLoopMusic();
    else this.context.audio.startLoopMusic(this.simulation.getTracks().length);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get needsResume(): boolean {
    return this.awaitingResume;
  }

  resumeFromBackground(): void {
    this.awaitingResume = false;
    this.events.emit('resume-changed', false);
  }

  private onHidden(): void {
    // Pause on hidden tab, then require an explicit resume countdown rather
    // than dropping the player back into a minute already in progress.
    if (this.simulation.isFinished) return;
    this.awaitingResume = true;
    this.events.emit('resume-changed', true);
  }

  private onVisible(): void {
    if (this.simulation.isFinished) return;
    this.events.emit('resume-changed', this.awaitingResume);
  }

  private applyQuality(): void {
    const cap = Math.min(window.devicePixelRatio || 1, this.context.quality.pixelRatioCap);
    this.game.registry.set('pixelRatioCap', cap);
  }

  // --- Development ---------------------------------------------------------

  private setupDebugOverlay(): void {
    this.debugGraphics = this.add.graphics().setDepth(Depth.overlay).setVisible(false);
    this.input.keyboard?.on('keydown-G', () => {
      this.debugGraphics?.setVisible(!this.debugGraphics.visible);
    });
  }

  private drawDebug(): void {
    const g = this.debugGraphics;
    if (!g || !g.visible) return;
    g.clear();

    const grid = this.scenario.navGrid;
    g.lineStyle(1, Palette.timeTeal, 0.14);
    for (let row = 0; row <= grid.height; row++) {
      g.lineBetween(0, row * grid.cellSize, grid.width * grid.cellSize, row * grid.cellSize);
    }
    for (let col = 0; col <= grid.width; col++) {
      g.lineBetween(col * grid.cellSize, 0, col * grid.cellSize, grid.height * grid.cellSize);
    }

    for (const actor of this.simulation.getWorld().actors.values()) {
      if (actor.path.length === 0) continue;
      g.lineStyle(2, Palette.readyGold, 0.6);
      g.beginPath();
      g.moveTo(actor.position.x, actor.position.y);
      for (let i = actor.pathIndex; i < actor.path.length; i++) {
        g.lineTo(actor.path[i]!.x, actor.path[i]!.y);
      }
      g.strokePath();
    }
  }

  devSnapshot(): DevSnapshot {
    const world = this.simulation.getWorld();
    return {
      scene: SceneKeys.Scenario,
      tick: world.tick,
      runNumber: this.simulation.currentRunNumber,
      remainingSeconds: Math.ceil(this.simulation.remainingTicks / TICKS_PER_SECOND),
      actorCount: world.actors.size,
      enemyCount: world.enemies.size,
      reservationCount: this.simulation.slots.reservationCount(world),
      listenerCount: this.simulation.bus.listenerCount(),
      gateHealth: world.stations.get('main_gate')?.health ?? null,
      trackCount: this.simulation.getTracks().length,
      objectives: this.simulation.objectives.objectiveStates.map((state) => ({
        id: state.definition.id,
        complete: state.complete,
        impossible: state.impossible,
        text: state.progressText,
      })),
    };
  }

  // --- Teardown ------------------------------------------------------------

  /**
   * Restart must dispose every timer, listener, tween, pooled effect and sound
   * the scenario started (design document section 20). The development bridge
   * reports the counts this guarantees.
   */
  private teardown(): void {
    this.game.events.off('echohold:hidden', this.onHidden, this);
    this.game.events.off('echohold:visible', this.onVisible, this);
    this.longPressTimer?.remove();
    this.longPressTimer = null;
    this.time.removeAllEvents();
    this.tweens.killAll();
    this.input.removeAllListeners();
    this.clearViews();
    this.feedback?.dispose();
    this.tutorial?.dispose();
    this.simulation?.dispose();
    this.context.audio.stopLoopMusic();
  }

  get designSize(): { width: number; height: number } {
    return { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
  }
}
