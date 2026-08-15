import Phaser from 'phaser';
import { CONTEXT_KEY, type GameContext } from '../GameContext';
import { DESIGN_WIDTH, Depth, Palette, SceneKeys } from '../config/gameConfig';
import type { MedalTier } from '../core/types';
import { BROKEN_GATE } from '../data/scenarios/brokenGate';
import { HUB_SECTIONS } from '../systems/ProgressionSystem';
import { Button } from '../ui/Button';
import { SettingsPanel } from '../ui/SettingsPanel';

interface HubEntry {
  id: string;
  title: string;
  chapter: string;
  locked: boolean;
  lockReason?: string;
}

const MEDAL_GLYPH: Record<MedalTier, string> = { BRONZE: '●', SILVER: '◆', GOLD: '★' };

/**
 * The Fortress Hub.
 *
 * Completed scenarios stabilise part of the real fortress, so the hub is the
 * permanent record of progress: the gatehouse is a ruin until The Broken Gate
 * is solved, and then it visibly stands (design document section 14).
 */
export class HubScene extends Phaser.Scene {
  private context!: GameContext;
  private settingsPanel: SettingsPanel | null = null;
  private horizon = 300;

  constructor() {
    super(SceneKeys.Hub);
  }

  create(): void {
    this.context = this.game.registry.get(CONTEXT_KEY) as GameContext;
    this.cameras.main.setBackgroundColor(Palette.ink);

    this.paintFortress();
    this.paintHeader();
    this.paintScenarioList();
    this.paintFooter();

    this.cameras.main.fadeIn(220, 12, 18, 26);
  }

  // --- Fortress diorama ----------------------------------------------------

  private paintFortress(): void {
    const restored = new Set(this.context.save.restoredHubSectionIds);
    const horizon = Math.round(this.scale.height * 0.33);
    this.horizon = horizon;

    // Sky and glow first, ground over the top: the light belongs behind the
    // fortress, not spilled across the courtyard in front of it.
    const sky = this.add.graphics().setDepth(Depth.ground);
    sky.fillStyle(Palette.timeViolet, 1);
    sky.fillRect(0, 0, DESIGN_WIDTH, horizon);
    sky.fillStyle(Palette.readyGold, restored.size > 0 ? 0.16 : 0.06);
    sky.fillCircle(DESIGN_WIDTH / 2, horizon - 30, 170);

    const g = this.add.graphics().setDepth(Depth.groundDecal);

    // Keep.
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(160, horizon - 120, 160, 120);
    g.fillStyle(Palette.stoneBase, 1);
    g.fillRect(166, horizon - 114, 148, 108);

    // The gatehouse: a ruin until the first scenario is stabilised.
    const gateRestored = restored.has('gatehouse');
    g.fillStyle(gateRestored ? Palette.stoneBase : Palette.stoneDark, 1);
    g.fillRect(196, horizon - 62, 88, 62);
    if (gateRestored) {
      g.fillStyle(Palette.timber, 1);
      g.fillRoundedRect(214, horizon - 50, 52, 50, { tl: 24, tr: 24, bl: 0, br: 0 });
      g.fillStyle(Palette.readyGold, 0.9);
      // Banners return with the residents.
      g.fillTriangle(196, horizon - 62, 208, horizon - 62, 202, horizon - 40);
      g.fillTriangle(272, horizon - 62, 284, horizon - 62, 278, horizon - 40);
    } else {
      g.fillStyle(Palette.ink, 1);
      g.fillTriangle(214, horizon, 232, horizon - 44, 250, horizon);
      g.fillTriangle(250, horizon, 262, horizon - 30, 276, horizon);
    }

    // Bell tower, always present - it is why the fortress is trapped.
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(112, horizon - 150, 42, 150);
    g.fillStyle(Palette.ochre, gateRestored ? 1 : 0.5);
    g.fillRoundedRect(122, horizon - 176, 22, 26, { tl: 11, tr: 11, bl: 2, br: 2 });

    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(330, horizon - 92, 40, 92);

    const ground = this.add.graphics().setDepth(Depth.stationBase);
    ground.fillStyle(Palette.inkSoft, 1);
    ground.fillRect(0, horizon, DESIGN_WIDTH, this.scale.height - horizon);
    ground.fillStyle(Palette.stoneDark, 0.5);
    ground.fillRect(0, horizon, DESIGN_WIDTH, 3);

    const caption = gateRestored
      ? HUB_SECTIONS['gatehouse']!.description
      : 'The north gate is still a gap in the wall.';
    this.add
      .text(DESIGN_WIDTH / 2, horizon + 40, caption, {
        fontSize: '12px',
        color: gateRestored ? '#f0b357' : '#647b91',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        align: 'center',
        wordWrap: { width: 340 },
      })
      .setOrigin(0.5)
      .setDepth(Depth.hud);
  }

  private paintHeader(): void {
    this.add
      .text(20, 26, 'ECHOHOLD', {
        fontSize: '18px',
        color: '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 5,
      })
      .setDepth(Depth.hud);

    this.add
      .text(
        20,
        50,
        `Stability ${this.context.save.stability}   ·   Shards ${this.context.save.memoryShards}`,
        {
          fontSize: '12px',
          color: '#90a2b5',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        },
      )
      .setDepth(Depth.hud);

    new Button(this, DESIGN_WIDTH - 46, 38, '⚙', () => this.openSettings(), {
      width: 44,
      height: 44,
      variant: 'ghost',
      fontSize: 18,
    }).container.setDepth(Depth.hud);
  }

  // --- Scenario list -------------------------------------------------------

  private entries(): HubEntry[] {
    const gateDone = this.context.hasCompleted(BROKEN_GATE.id);
    return [
      { id: BROKEN_GATE.id, title: BROKEN_GATE.title, chapter: 'Chapter 1 · Emberwatch', locked: false },
      {
        id: 'dry_well',
        title: 'The Dry Well',
        chapter: 'Chapter 1 · Emberwatch',
        locked: true,
        lockReason: gateDone ? 'Being rebuilt' : 'Stabilise the gate first',
      },
      {
        id: 'frostwall',
        title: 'Frostwall',
        chapter: 'Chapter 2',
        locked: true,
        lockReason: 'Beyond the north road',
      },
    ];
  }

  private paintScenarioList(): void {
    const entries = this.entries();
    // Anchored to the bottom so the card stack sits under the thumb on a tall
    // phone and stays clear of the diorama on a short one.
    const bottom = this.scale.height - 62;
    let y = bottom - (entries.length - 1) * 86;
    y = Math.max(y, this.horizon + 84);
    for (const entry of entries) {
      this.paintScenarioCard(entry, y);
      y += 86;
    }
  }

  private paintScenarioCard(entry: HubEntry, y: number): void {
    const width = DESIGN_WIDTH - 40;
    const x = DESIGN_WIDTH / 2;
    const medal = this.context.save.medalByScenarioId[entry.id];

    const card = this.add.graphics().setDepth(Depth.hud);
    card.fillStyle(entry.locked ? Palette.ink : Palette.inkSoft, entry.locked ? 0.6 : 1);
    card.fillRoundedRect(x - width / 2, y - 32, width, 70, 12);
    card.lineStyle(1, entry.locked ? Palette.stoneDark : Palette.stoneBase, 1);
    card.strokeRoundedRect(x - width / 2, y - 32, width, 70, 12);

    this.add
      .text(x - width / 2 + 18, y - 20, entry.chapter, {
        fontSize: '10px',
        color: entry.locked ? '#46586b' : '#90a2b5',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        letterSpacing: 2,
      })
      .setDepth(Depth.hud);

    this.add
      .text(x - width / 2 + 18, y - 4, entry.title, {
        fontSize: '17px',
        color: entry.locked ? '#5d6d7e' : '#f4e6cd',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setDepth(Depth.hud);

    if (medal) {
      // Icon plus text, never colour alone.
      this.add
        .text(x - width / 2 + 18, y + 20, `${MEDAL_GLYPH[medal]} ${medal.toLowerCase()}`, {
          fontSize: '11px',
          color: '#f0b357',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setDepth(Depth.hud);
    } else if (entry.locked && entry.lockReason) {
      this.add
        .text(x - width / 2 + 18, y + 20, entry.lockReason, {
          fontSize: '11px',
          color: '#46586b',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        })
        .setDepth(Depth.hud);
    }

    const button = new Button(
      this,
      x + width / 2 - 58,
      y + 2,
      entry.locked ? 'Locked' : medal ? 'Replay' : 'Enter',
      () => this.enter(entry.id),
      { width: 92, height: 40, variant: entry.locked ? 'ghost' : 'primary', fontSize: 13 },
    );
    button.container.setDepth(Depth.hud);
    button.setDisabled(entry.locked);
  }

  private enter(scenarioId: string): void {
    if (scenarioId !== BROKEN_GATE.id) return;
    this.context.audio.unlock();
    this.context.audio.play('ui-tap');
    this.cameras.main.fadeOut(180, 12, 18, 26);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SceneKeys.Scenario, { scenarioId });
    });
  }

  private paintFooter(): void {
    this.add
      .text(DESIGN_WIDTH / 2, this.scale.height - 24, 'One minute. As many of you as it takes.', {
        fontSize: '11px',
        color: '#46586b',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(Depth.hud);
  }

  private openSettings(): void {
    if (this.settingsPanel) return;
    this.settingsPanel = new SettingsPanel(this, this.context, () => {
      this.settingsPanel?.destroy();
      this.settingsPanel = null;
      // Settings can reset the save, so redraw the whole hub from scratch.
      this.scene.restart();
    });
  }
}
