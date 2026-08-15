import Phaser from 'phaser';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { DESIGN_WIDTH, Depth, Palette, SceneKeys, TICKS_PER_SECOND } from '../config/gameConfig';
import { Button } from '../ui/Button';
import { TimelineView, type TimelineSelection } from '../ui/TimelineView';
import type { ScenarioScene } from './ScenarioScene';
import type { UIScene } from './UIScene';

/**
 * The timeline review (design document section 18).
 *
 * A horizontal 0-60 second strip with one row per Echo, plus playback speed,
 * jump-to-first-fracture, track renaming and overwrite selection. Selecting an
 * event focuses the camera on the station involved and prints one
 * plain-language cause - derived from the journal, never guessed.
 */
export class TimelineReviewScene extends Phaser.Scene {
  private scenarioScene!: ScenarioScene;
  private uiScene!: UIScene;
  private context!: GameContext;

  private timeline!: TimelineView;
  private causeText!: Phaser.GameObjects.Text;
  private speedButtons: Button[] = [];
  private buttons: Button[] = [];

  private playing = false;
  private playbackSpeed = 1;
  private playheadTick = 0;

  constructor() {
    super(SceneKeys.TimelineReview);
  }

  init(data: { scenario: ScenarioScene; ui: UIScene }): void {
    this.scenarioScene = data.scenario;
    this.uiScene = data.ui;
  }

  create(): void {
    this.context = this.game.registry.get(CONTEXT_KEY) as GameContext;
    const simulation = this.scenarioScene.simulation;

    this.add
      .rectangle(DESIGN_WIDTH / 2, this.scale.height / 2, DESIGN_WIDTH, this.scale.height, Palette.ink, 0.97)
      .setDepth(Depth.overlay)
      .setInteractive();

    this.add
      .text(DESIGN_WIDTH / 2, 42, 'Timeline', {
        fontSize: '22px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setDepth(Depth.overlay + 1);

    this.add
      .text(DESIGN_WIDTH / 2, 68, 'Tap any block to see what happened there.', {
        fontSize: '11px',
        color: '#647b91',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(Depth.overlay + 1);

    this.timeline = new TimelineView(
      this,
      74,
      110,
      DESIGN_WIDTH - 96,
      simulation.scenario.durationTicks,
      (selection) => this.onSelect(selection),
    );
    this.timeline.render(simulation.getTracks(), simulation.recorder.peek(), simulation.bus.getJournal());

    this.causeText = this.add
      .text(DESIGN_WIDTH / 2, 372, this.initialCause(), {
        fontSize: '12px',
        color: '#e8dcc0',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: DESIGN_WIDTH - 60 },
      })
      .setOrigin(0.5, 0)
      .setDepth(Depth.overlay + 2);

    this.buildControls();
  }

  private initialCause(): string {
    const diagnosis = this.scenarioScene.simulation.getResult()?.diagnosis;
    if (!diagnosis) return 'Select a command to see its cause.';
    return `${diagnosis.headline}\n${diagnosis.detail}`;
  }

  private buildControls(): void {
    const simulation = this.scenarioScene.simulation;
    let y = 456;

    // Playback transport.
    const playButton = new Button(this, 74, y, '▶', () => {
      this.playing = !this.playing;
      playButton.setText(this.playing ? '‖' : '▶');
    }, { width: 56, height: 40, fontSize: 14 });
    this.buttons.push(playButton);

    [0.5, 1, 2].forEach((speed, index) => {
      const button = new Button(
        this,
        146 + index * 62,
        y,
        `${speed}x`,
        () => {
          this.playbackSpeed = speed;
          this.speedButtons.forEach((b, i) => b.setSelected(i === index));
        },
        { width: 56, height: 40, variant: 'secondary', fontSize: 13 },
      );
      button.setSelected(speed === 1);
      this.speedButtons.push(button);
      this.buttons.push(button);
    });

    y += 56;

    const fractureTick = this.firstFractureTick();
    const jump = new Button(
      this,
      DESIGN_WIDTH / 2,
      y,
      fractureTick === null ? 'No fractures to jump to' : 'Jump to the first fracture',
      () => {
        if (fractureTick === null) return;
        this.playheadTick = fractureTick;
        this.playing = false;
        this.focusOnFirstFracture();
      },
      { width: 280, height: 42, variant: 'secondary', fontSize: 13 },
    );
    jump.setDisabled(fractureTick === null);
    this.buttons.push(jump);

    y += 54;

    // Track management: rename and overwrite, per section 18.
    const tracks = simulation.getTracks();
    tracks.forEach((track, index) => {
      const rename = new Button(
        this,
        DESIGN_WIDTH / 2 - 68,
        y,
        `Rename ${track.label ?? `Echo ${index + 1}`}`,
        () => {
          const next = window.prompt('Rename this Echo', track.label ?? `Echo ${index + 1}`);
          if (next) {
            simulation.renameTrack(index, next);
            rename.setText(`Rename ${next.slice(0, 12)}`);
            this.timeline.render(simulation.getTracks(), simulation.recorder.peek(), simulation.bus.getJournal());
          }
        },
        { width: 176, height: 36, variant: 'ghost', fontSize: 11 },
      );
      const overwrite = new Button(
        this,
        DESIGN_WIDTH / 2 + 92,
        y,
        'Overwrite',
        () => {
          this.close();
          this.scenarioScene.overwriteAndRetry(index);
        },
        { width: 120, height: 36, variant: 'secondary', fontSize: 11 },
      );
      this.buttons.push(rename, overwrite);
      y += 44;
    });

    y = Math.max(y + 10, this.scale.height - 130);

    this.buttons.push(
      new Button(this, DESIGN_WIDTH / 2, y, 'Restart the loop', () => {
        this.close();
        this.scenarioScene.restartImmediately();
      }, { width: 250, height: 44, fontSize: 14 }),
    );

    this.buttons.push(
      new Button(this, DESIGN_WIDTH / 2, y + 56, 'Back', () => this.close(), {
        width: 250,
        height: 44,
        variant: 'ghost',
        fontSize: 14,
      }),
    );

    for (const button of this.buttons) button.container.setDepth(Depth.overlay + 2);
  }

  private firstFractureTick(): number | null {
    const fractures = this.scenarioScene.simulation.bus.find('ECHO_FRACTURED');
    return fractures.length > 0 ? fractures[0]!.tick : null;
  }

  private focusOnFirstFracture(): void {
    const fractures = this.scenarioScene.simulation.bus.find('ECHO_FRACTURED');
    const first = fractures[0];
    if (!first) return;
    this.onSelect({
      tick: first.tick,
      cause: `An Echo fractured at ${(first.tick / TICKS_PER_SECOND).toFixed(1)}s because ${first.payload.reason
        .toLowerCase()
        .replace(/_/g, ' ')}.`,
      ...(first.targetId !== undefined ? { focusTargetId: first.targetId } : {}),
    });
  }

  private onSelect(selection: TimelineSelection): void {
    this.playheadTick = selection.tick;
    this.causeText.setText(selection.cause);
    this.context.audio.play('ui-tap');

    // Focus the world camera on the station involved, so the sentence and the
    // place it describes are seen together.
    if (selection.focusTargetId) {
      const station = this.scenarioScene.simulation.getWorld().stations.get(selection.focusTargetId);
      if (station) {
        this.scenarioScene.cameras.main.pan(station.position.x, station.position.y, 340, 'Quad.easeOut');
      }
    }
  }

  override update(_time: number, delta: number): void {
    if (this.playing) {
      this.playheadTick += (delta / 1000) * TICKS_PER_SECOND * this.playbackSpeed;
      if (this.playheadTick >= this.scenarioScene.simulation.scenario.durationTicks) {
        this.playheadTick = 0;
        this.playing = false;
      }
    }
    const rowCount = this.scenarioScene.simulation.getTracks().length + 1;
    this.timeline.setPlayhead(this.playheadTick, rowCount);
  }

  private close(): void {
    this.uiScene.onReviewClosed();
    this.scene.stop();
  }
}
