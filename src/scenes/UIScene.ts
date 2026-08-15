import Phaser from 'phaser';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { DESIGN_WIDTH, Depth, Palette, SceneKeys } from '../config/gameConfig';
import type { MedalTier } from '../core/types';
import { getStationDefinition } from '../data/stations';
import type { LoopResult } from '../systems/ScenarioSimulation';
import { UPGRADE_LIBRARY, type GrantedReward } from '../systems/ProgressionSystem';
import type { SimStation } from '../systems/world';
import { ActiveHud } from '../ui/ActiveHud';
import { Button } from '../ui/Button';
import { EchoRoster } from '../ui/EchoRoster';
import { RadialMenu, type RadialOption } from '../ui/RadialMenu';
import { SettingsPanel } from '../ui/SettingsPanel';
import type { ScenarioScene } from './ScenarioScene';

const MEDAL_GLYPH: Record<MedalTier, string> = { BRONZE: '●', SILVER: '◆', GOLD: '★' };

/**
 * All interface for an active scenario, running in parallel with the world.
 *
 * Keeping the HUD in its own scene means an overlay never has to fight the
 * world camera's zoom or follow bias, and pausing the simulation cannot
 * accidentally freeze the buttons that unpause it.
 */
export class UIScene extends Phaser.Scene {
  private scenarioScene!: ScenarioScene;
  private context!: GameContext;

  private hud!: ActiveHud;
  private roster!: EchoRoster;
  private pauseButton!: Button;
  private restartButton!: Button;

  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayButtons: Button[] = [];
  private tutorialPanel: Phaser.GameObjects.Container | null = null;
  private tutorialButton: Button | null = null;
  private radial: RadialMenu | null = null;
  private settingsPanel: SettingsPanel | null = null;

  private topInset = 12;
  private bottomInset = 12;

  constructor() {
    super(SceneKeys.UI);
  }

  init(data: { scenario: ScenarioScene }): void {
    this.scenarioScene = data.scenario;
  }

  create(): void {
    this.context = this.game.registry.get(CONTEXT_KEY) as GameContext;

    const safeArea = this.game.registry.get('safeArea') as { top: number; bottom: number } | undefined;
    // Leave room for a notch and a home indicator; nothing essential goes there.
    this.topInset = 12 + (safeArea?.top ?? 0);
    this.bottomInset = 14 + (safeArea?.bottom ?? 0);

    this.hud = new ActiveHud(this, this.topInset, this.context.settings.largeText);
    this.hud.setCarriedPosition(this.scale.height - this.bottomInset - 88);
    this.roster = new EchoRoster(this, 12, this.topInset + 96);

    this.pauseButton = new Button(
      this,
      DESIGN_WIDTH - 38,
      this.topInset + 26,
      '‖',
      () => this.scenarioScene.togglePause(),
      { width: 42, height: 42, variant: 'ghost', fontSize: 15 },
    );
    this.pauseButton.container.setDepth(Depth.hud);

    // Restart is always two taps away, and takes under a second.
    this.restartButton = new Button(
      this,
      DESIGN_WIDTH - 38,
      this.topInset + 74,
      '↺',
      () => this.confirmRestart(),
      { width: 42, height: 42, variant: 'ghost', fontSize: 15 },
    );
    this.restartButton.container.setDepth(Depth.hud);

    this.bindScenarioEvents();
  }

  private bindScenarioEvents(): void {
    const scene = this.scenarioScene.events;

    scene.on('loop-ended', (result: LoopResult) => this.showResult(result));
    scene.on('run-started', () => this.clearOverlay());
    scene.on('pause-changed', (paused: boolean) => {
      if (paused) this.showPause();
      else if (this.overlayKind === 'pause') this.clearOverlay();
    });
    scene.on('resume-changed', (needsResume: boolean) => {
      if (needsResume) this.showResume();
      else if (this.overlayKind === 'resume') this.clearOverlay();
    });
    scene.on('request-restart', () => this.confirmRestart());
    scene.on('radial-request', (payload: { station: SimStation; screen: { x: number; y: number } }) => {
      this.showRadial(payload.station, payload.screen);
    });

    this.scenarioScene.simulation.bus.on('STATION_DAMAGED', () => {
      this.hud.flashDanger(this.context.settings.reduceMotion);
    });
  }

  override update(): void {
    const simulation = this.scenarioScene.simulation;
    this.hud.update(simulation, this.context.settings.reduceMotion);
    this.roster.update(simulation);
    this.syncTutorial();
  }

  // --- Tutorial ------------------------------------------------------------

  private syncTutorial(): void {
    const step = this.scenarioScene.tutorial.current;
    if (!step) {
      this.clearTutorial();
      return;
    }
    if (this.tutorialPanel?.getData('stepId') === step.id) return;

    this.clearTutorial();

    const y = this.scale.height - this.bottomInset - 148;
    const background = this.add.graphics();
    background.fillStyle(Palette.inkSoft, 0.96);
    background.fillRoundedRect(20, y - 34, DESIGN_WIDTH - 40, 68, 12);
    background.lineStyle(1, Palette.stoneBase, 1);
    background.strokeRoundedRect(20, y - 34, DESIGN_WIDTH - 40, 68, 12);

    const text = this.add
      .text(DESIGN_WIDTH / 2, y - 6, step.text, {
        fontSize: this.context.settings.largeText ? '15px' : '13px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: DESIGN_WIDTH - 80 },
      })
      .setOrigin(0.5);

    this.tutorialPanel = this.add.container(0, 0, [background, text]).setDepth(Depth.hud + 5);
    this.tutorialPanel.setData('stepId', step.id);

    if (step.completeOn.kind === 'ACKNOWLEDGED') {
      this.tutorialButton = new Button(
        this,
        DESIGN_WIDTH / 2,
        y + 46,
        'Got it',
        () => {
          this.scenarioScene.tutorial.acknowledge();
          this.clearTutorial();
        },
        { width: 130, height: 36, fontSize: 13 },
      );
      this.tutorialButton.container.setDepth(Depth.hud + 6);
    }
  }

  private clearTutorial(): void {
    this.tutorialPanel?.destroy(true);
    this.tutorialPanel = null;
    this.tutorialButton?.destroy();
    this.tutorialButton = null;
  }

  // --- Radial menu ---------------------------------------------------------

  private showRadial(station: SimStation, screen: { x: number; y: number }): void {
    if (this.radial) return;
    const simulation = this.scenarioScene.simulation;
    const world = simulation.getWorld();
    const warden = simulation.getWarden();
    const definition = getStationDefinition(station.definitionId);

    const carrying = warden.carrying;
    const options: RadialOption[] = [
      {
        type: 'MOVE_TO',
        label: 'Go',
        glyph: '»',
        enabled: true,
        hint: 'Walk here without doing anything else.',
      },
      {
        type: 'TAKE',
        label: 'Take',
        glyph: '↑',
        enabled: !carrying && simulation.production.nextTakeableItem(station) !== null,
        hint: carrying ? 'Your hands are full.' : 'Nothing here to pick up.',
      },
      {
        type: 'DELIVER',
        label: 'Give',
        glyph: '↓',
        enabled: Boolean(carrying && simulation.production.canAccept(station, carrying)),
        hint: carrying ? `${definition.displayName} does not take that.` : 'You are carrying nothing.',
      },
      {
        type: 'WORK',
        label: 'Work',
        glyph: '⚒',
        enabled: simulation.production.findReadyRecipe(station) !== null,
        hint: 'It needs its materials first.',
      },
    ];

    if (definition.kind === 'DEFENCE') {
      options.push({
        type: 'OPERATE',
        label: 'Fire',
        glyph: '➤',
        enabled: (station.outputs['loaded_shot'] ?? 0) > 0,
        hint: 'The ballista is not loaded.',
      });
    }
    if (definition.kind === 'SIGNAL') {
      options.push({
        type: 'SIGNAL',
        label: 'Ring',
        glyph: '◉',
        enabled: world.tick >= station.cooldownUntilTick,
        hint: 'The bell is still settling.',
      });
    }

    this.radial = new RadialMenu(
      this,
      screen.x,
      screen.y,
      definition.displayName,
      options,
      (option) => {
        simulation.issue({
          type: option.type,
          label: option.label,
          ...(option.type === 'MOVE_TO'
            ? { point: { x: station.position.x, y: station.position.y + 44 } }
            : { targetId: station.id }),
        });
        this.scenarioScene.tutorial.notePlayerCommand();
        this.context.audio.play('ui-tap');
        this.closeRadial();
      },
      () => this.closeRadial(),
    );
  }

  private closeRadial(): void {
    this.radial?.destroy();
    this.radial = null;
  }

  // --- Overlays ------------------------------------------------------------

  private overlayKind: 'pause' | 'resume' | 'result' | 'reward' | null = null;

  private clearOverlay(): void {
    for (const button of this.overlayButtons) button.destroy();
    this.overlayButtons = [];
    this.overlay?.destroy(true);
    this.overlay = null;
    this.overlayKind = null;
    this.hud.setVisible(true);
    this.roster.setVisible(true);
  }

  private beginOverlay(kind: typeof this.overlayKind, dim = 0.92): Phaser.GameObjects.Container {
    this.clearOverlay();
    this.overlayKind = kind;
    const background = this.add
      .rectangle(DESIGN_WIDTH / 2, this.scale.height / 2, DESIGN_WIDTH, this.scale.height, Palette.ink, dim)
      .setInteractive();
    this.overlay = this.add.container(0, 0, [background]).setDepth(Depth.overlay);
    return this.overlay;
  }

  private overlayTitle(text: string, y: number, size = 24, colour = '#f4e6cd'): Phaser.GameObjects.Text {
    const label = this.add
      .text(DESIGN_WIDTH / 2, y, text, {
        fontSize: `${size}px`,
        color: colour,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: DESIGN_WIDTH - 60 },
      })
      .setOrigin(0.5);
    this.overlay?.add(label);
    return label;
  }

  private overlayButton(
    y: number,
    text: string,
    onActivate: () => void,
    variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary',
    x = DESIGN_WIDTH / 2,
    width = 240,
  ): Button {
    const button = new Button(this, x, y, text, onActivate, { width, height: 46, variant, fontSize: 14 });
    button.container.setDepth(Depth.overlay + 1);
    this.overlayButtons.push(button);
    return button;
  }

  private showPause(): void {
    this.beginOverlay('pause');
    this.overlayTitle('Paused', 240, 26);
    this.overlayTitle('The minute is holding.', 276, 13, '#90a2b5');

    this.overlayButton(360, 'Resume', () => this.scenarioScene.setPaused(false));
    this.overlayButton(416, 'Restart the loop', () => this.scenarioScene.restartImmediately(), 'secondary');
    this.overlayButton(472, 'Settings', () => this.openSettings(), 'secondary');
    this.overlayButton(528, 'Leave for the fortress', () => this.scenarioScene.returnToHub(), 'ghost');
  }

  private showResume(): void {
    this.beginOverlay('resume');
    this.overlayTitle('Welcome back', 260, 24);
    this.overlayTitle('The loop paused while you were away.', 296, 13, '#90a2b5');
    // An explicit resume, never a silent drop back into a running minute.
    this.overlayButton(380, 'Resume the minute', () => this.scenarioScene.resumeFromBackground());
    this.overlayButton(436, 'Restart instead', () => this.scenarioScene.restartImmediately(), 'secondary');
  }

  private confirmRestart(): void {
    // Overwriting a recording is destructive, so it is confirmed - but the
    // confirmation is one tap, because restarting has to stay fast.
    this.beginOverlay('pause');
    this.overlayTitle('Restart this loop?', 280, 22);
    this.overlayTitle('The recording in progress will be lost.', 316, 12, '#90a2b5');
    this.overlayButton(390, 'Restart', () => this.scenarioScene.restartImmediately(), 'danger');
    this.overlayButton(446, 'Keep playing', () => {
      this.clearOverlay();
      this.scenarioScene.setPaused(false);
    }, 'ghost');
    this.scenarioScene.setPaused(true);
  }

  // --- Result --------------------------------------------------------------

  private showResult(result: LoopResult): void {
    this.beginOverlay('result', 0.97);
    this.hud.setVisible(false);
    this.roster.setVisible(false);

    const simulation = this.scenarioScene.simulation;
    const won = result.success;
    const height = this.scale.height;

    // Laid out from the top for the verdict and from the bottom for the
    // actions, so the choices sit under the thumb on any phone.
    let y = Math.max(96, height * 0.12);

    this.overlayTitle(this.resultTitle(result), y, 26, won ? '#ffd88a' : '#f4e6cd');
    y += 38;

    if (result.medal) {
      this.overlayTitle(`${MEDAL_GLYPH[result.medal]}  ${result.medal.toLowerCase()}`, y, 15, '#f0b357');
      y += 30;
    }

    // The first critical fracture, in plain language, straight away.
    const diagnosis = result.diagnosis;
    if (diagnosis) {
      const headline = this.overlayTitle(diagnosis.headline, y + 14, 16, won ? '#e8dcc0' : '#f0b357');
      y = headline.y + headline.height / 2 + 12;
      const detail = this.overlayTitle(diagnosis.detail, y + 12, 12, '#90a2b5');
      y = detail.y + detail.height / 2 + 20;
    }

    this.paintObjectiveSummary(result, y + 12);

    const actionsTop = won ? this.paintVictoryActions() : this.paintRetryActions(simulation.getTracks().length);
    void actionsTop;
  }

  private resultTitle(result: LoopResult): string {
    if (result.success) return 'The minute held';
    // A practice minute has not been failed; it has simply ended.
    if (result.quiet) return 'The minute resets';
    return result.reason === 'OBJECTIVE_IMPOSSIBLE' ? 'The plan broke' : 'The minute ran out';
  }

  private paintObjectiveSummary(result: LoopResult, y: number): void {
    result.objectives.forEach((state, index) => {
      const rowY = y + index * 26;
      const mark = state.complete ? '✓' : state.impossible ? '✕' : '·';
      const colour = state.complete ? '#a8d8a0' : state.impossible ? '#d4674a' : '#647b91';

      const glyph = this.add
        .text(46, rowY, mark, {
          fontSize: '13px',
          color: colour,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(0, 0.5);

      const label = this.add
        .text(68, rowY, `${state.definition.description}`, {
          fontSize: '12px',
          color: state.complete ? '#e8dcc0' : '#90a2b5',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          wordWrap: { width: 300 },
        })
        .setOrigin(0, 0.5);

      const tier = this.add
        .text(DESIGN_WIDTH - 46, rowY, state.definition.tier.toLowerCase(), {
          fontSize: '10px',
          color: '#46586b',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(1, 0.5);

      this.overlay?.add([glyph, label, tier]);
    });
  }

  private paintRetryActions(trackCount: number): number {
    const simulation = this.scenarioScene.simulation;
    const canKeep =
      simulation.recordedCommandCount > 0 && trackCount < simulation.scenario.maxEchoTracks;

    const actions: Array<[string, () => void, 'primary' | 'secondary' | 'ghost']> = [];
    if (canKeep) {
      actions.push(['Keep this run as an Echo', () => this.promptLabelAndKeep(), 'primary']);
    } else if (simulation.recordedCommandCount > 0 && trackCount > 0) {
      actions.push(['Overwrite an Echo', () => this.showOverwriteChooser(), 'primary']);
    }
    actions.push(['Try again without keeping it', () => this.scenarioScene.discardAndRetry(), 'secondary']);
    actions.push(['Review the timeline', () => this.openReview(), 'secondary']);
    actions.push(['Leave for the fortress', () => this.scenarioScene.returnToHub(), 'ghost']);

    return this.paintActionStack(actions);
  }

  private paintVictoryActions(): number {
    return this.paintActionStack([
      ['Claim the reward', () => this.claimRewards(), 'primary'],
      ['Review the timeline', () => this.openReview(), 'secondary'],
      ['Play it again', () => this.scenarioScene.discardAndRetry(), 'ghost'],
    ]);
  }

  /** Bottom-anchored stack, so the primary action is always thumb-reachable. */
  private paintActionStack(
    actions: Array<[string, () => void, 'primary' | 'secondary' | 'ghost']>,
  ): number {
    const spacing = 54;
    const bottom = this.scale.height - this.bottomInset - 34;
    const top = bottom - (actions.length - 1) * spacing;
    actions.forEach(([label, handler, variant], index) => {
      this.overlayButton(top + index * spacing, label, handler, variant);
    });
    return top;
  }

  /** Track naming: a short role label such as "Wood" or "Ballista". */
  private promptLabelAndKeep(): void {
    const suggestion = this.suggestLabel();
    const label = window.prompt('Name this Echo (optional)', suggestion) ?? suggestion;
    this.scenarioScene.keepAndRetry(label.slice(0, 12) || undefined);
  }

  /** Names the track after the station it interacted with most. */
  private suggestLabel(): string {
    const counts = new Map<string, number>();
    for (const command of this.scenarioScene.simulation.recorder.peek()) {
      if (!command.targetId) continue;
      counts.set(command.targetId, (counts.get(command.targetId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = id;
      }
    }
    if (!best) return 'Echo';
    const station = this.scenarioScene.simulation.getWorld().stations.get(best);
    if (!station) return 'Echo';
    return getStationDefinition(station.definitionId).displayName.split(' ')[0] ?? 'Echo';
  }

  private showOverwriteChooser(): void {
    this.beginOverlay('result', 0.95);
    this.overlayTitle('Which Echo does this replace?', 200, 20);

    const tracks = this.scenarioScene.simulation.getTracks();
    tracks.forEach((track, index) => {
      this.overlayButton(
        280 + index * 58,
        track.label ?? `Echo ${index + 1}`,
        () => this.scenarioScene.overwriteAndRetry(index),
        'secondary',
      );
    });

    this.overlayButton(280 + tracks.length * 58 + 12, 'Cancel', () => {
      const result = this.scenarioScene.simulation.getResult();
      if (result) this.showResult(result);
    }, 'ghost');
  }

  private openReview(): void {
    this.scene.launch(SceneKeys.TimelineReview, { scenario: this.scenarioScene, ui: this });
    this.scene.setVisible(false);
  }

  /** Called by the review scene when it closes. */
  onReviewClosed(): void {
    this.scene.setVisible(true);
  }

  // --- Rewards -------------------------------------------------------------

  private claimRewards(): void {
    const scenario = this.scenarioScene.simulation.scenario;
    const medal = this.scenarioScene.simulation.getResult()?.medal ?? 'BRONZE';
    const outcome = this.context.progression.applyCompletion(this.context.save, scenario, medal);

    this.context.setSave(outcome.save);
    const persisted = this.context.persist();
    if (!persisted) {
      this.scenarioScene.simulation.bus.emit(
        'SAVE_FAILED',
        { tick: 0, scenarioId: scenario.id, sourceId: 'progression' },
        { message: 'Progress could not be written to this browser.' },
      );
    }

    const choice = outcome.rewards.find((reward) => reward.kind === 'UPGRADE_CHOICE');
    if (choice?.options?.length) this.showUpgradeChoice(choice, outcome.rewards, persisted);
    else this.showRewardSummary(outcome.rewards, persisted);
  }

  private showUpgradeChoice(choice: GrantedReward, rewards: GrantedReward[], persisted: boolean): void {
    this.beginOverlay('reward', 0.96);
    this.overlayTitle(choice.headline, 190, 22, '#ffd88a');
    this.overlayTitle(choice.detail, 226, 12, '#90a2b5');

    (choice.options ?? []).forEach((upgradeId, index) => {
      const upgrade = UPGRADE_LIBRARY[upgradeId];
      const y = 310 + index * 130;

      const name = this.add
        .text(DESIGN_WIDTH / 2, y, upgrade?.name ?? upgradeId, {
          fontSize: '17px',
          color: '#f4e6cd',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setOrigin(0.5);
      const description = this.add
        .text(DESIGN_WIDTH / 2, y + 30, upgrade?.description ?? '', {
          fontSize: '12px',
          color: '#90a2b5',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          align: 'center',
          wordWrap: { width: DESIGN_WIDTH - 80 },
        })
        .setOrigin(0.5);
      this.overlay?.add([name, description]);

      this.overlayButton(y + 76, 'Choose', () => {
        this.context.setSave(this.context.progression.chooseUpgrade(this.context.save, upgradeId));
        this.context.persist();
        this.showRewardSummary(rewards, persisted);
      });
    });
  }

  private showRewardSummary(rewards: GrantedReward[], persisted: boolean): void {
    this.beginOverlay('reward', 0.96);
    this.overlayTitle('The fortress remembers', 180, 24, '#ffd88a');

    let y = 250;
    for (const reward of rewards) {
      if (reward.kind === 'UPGRADE_CHOICE') continue;
      const headline = this.add
        .text(DESIGN_WIDTH / 2, y, reward.headline, {
          fontSize: '15px',
          color: '#f0b357',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          align: 'center',
          wordWrap: { width: DESIGN_WIDTH - 70 },
        })
        .setOrigin(0.5);
      const detail = this.add
        .text(DESIGN_WIDTH / 2, y + 26, reward.detail, {
          fontSize: '12px',
          color: '#90a2b5',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          align: 'center',
          wordWrap: { width: DESIGN_WIDTH - 70 },
        })
        .setOrigin(0.5);
      this.overlay?.add([headline, detail]);
      y += 76;
    }

    if (!persisted) {
      // Never silently lose progress: say so plainly.
      const warning = this.add
        .text(DESIGN_WIDTH / 2, y, 'This browser refused to store the save, so this progress will not survive a reload.', {
          fontSize: '11px',
          color: '#d4674a',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          align: 'center',
          wordWrap: { width: DESIGN_WIDTH - 70 },
        })
        .setOrigin(0.5);
      this.overlay?.add(warning);
      y += 50;
    }

    this.overlayButton(Math.max(y + 20, 560), 'Return to the fortress', () => this.scenarioScene.returnToHub());
    this.overlayButton(Math.max(y + 74, 614), 'Play it again', () => this.scenarioScene.discardAndRetry(), 'ghost');
  }

  private openSettings(): void {
    if (this.settingsPanel) return;
    this.settingsPanel = new SettingsPanel(this, this.context, () => {
      this.settingsPanel?.destroy();
      this.settingsPanel = null;
    });
  }
}
