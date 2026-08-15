import Phaser from 'phaser';
import { Palette } from '../config/gameConfig';

/**
 * Generates every runtime texture as flat vector shapes at boot.
 *
 * The design document forbids mixing incompatible asset styles and forbids
 * unstyled primitives in front of the player. Authoring the whole set here in
 * one palette gives a coherent hand-drawn diorama look, keeps the build free of
 * binary assets, and means a later art pass can replace these one key at a
 * time without touching gameplay code.
 *
 * Shape language (section 17):
 *   friendly  - rounded caps, open silhouettes
 *   hostile   - forward-pointing triangles, compressed poses
 *   important - arch and bell motifs, repeated across chapters
 */
export function generateTextures(scene: Phaser.Scene): void {
  const made = (key: string) => scene.textures.exists(key);
  if (made('station-bell')) return; // already generated this session

  draw(scene, 'ground-tile', 64, 64, (g) => {
    g.fillStyle(Palette.groundBase, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(Palette.groundLight, 0.35);
    // Irregular flagstones: three sizes so the tiling never reads as a grid.
    g.fillRect(3, 3, 27, 26);
    g.fillRect(34, 5, 26, 22);
    g.fillRect(5, 33, 22, 26);
    g.fillRect(31, 31, 29, 28);
    g.fillStyle(Palette.stoneDark, 0.16);
    g.fillRect(0, 30, 64, 2);
    g.fillRect(30, 0, 2, 64);
  });

  draw(scene, 'wall-tile', 64, 64, (g) => {
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(Palette.stoneBase, 1);
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 === 0 ? 0 : 16;
      for (let col = -1; col < 4; col++) {
        g.fillRect(col * 32 + offset + 2, row * 16 + 2, 28, 12);
      }
    }
    g.fillStyle(Palette.stoneLight, 0.22);
    g.fillRect(0, 0, 64, 3);
  });

  // --- Actors -------------------------------------------------------------
  // Bodies are drawn white and tinted at runtime, so one texture serves the
  // living Warden and every pale Echo.

  draw(scene, 'actor-body', 22, 26, (g) => {
    g.fillStyle(0xffffff, 1);
    // Cloak: open silhouette, wider at the hem.
    g.fillRoundedRect(2, 6, 18, 18, { tl: 7, tr: 7, bl: 3, br: 3 });
    g.fillRect(1, 20, 20, 5);
  });

  draw(scene, 'actor-head', 14, 14, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(7, 7, 6);
  });

  draw(scene, 'actor-limb', 6, 12, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, 6, 12, 3);
  });

  draw(scene, 'shadow', 34, 16, (g) => {
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(17, 8, 32, 13);
  });

  // --- Carried items ------------------------------------------------------

  draw(scene, 'item-timber', 20, 16, (g) => {
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(0, 2, 20, 5, 2);
    g.fillRoundedRect(0, 9, 20, 5, 2);
    g.fillStyle(Palette.timber, 1);
    g.fillRoundedRect(1, 3, 18, 3, 1);
    g.fillRoundedRect(1, 10, 18, 3, 1);
    g.lineStyle(1, Palette.ochre, 0.9);
    g.strokeRect(8, 1, 4, 14);
  });

  draw(scene, 'item-plank', 22, 10, (g) => {
    g.fillStyle(Palette.timber, 1);
    g.fillRoundedRect(0, 1, 22, 8, 2);
    g.fillStyle(Palette.ochre, 0.6);
    g.fillRect(2, 3, 18, 1);
    g.fillRect(2, 6, 18, 1);
  });

  draw(scene, 'item-bolt', 24, 10, (g) => {
    g.fillStyle(Palette.stoneLight, 1);
    g.fillRect(4, 4, 16, 3);
    g.fillStyle(Palette.parchment, 1);
    // Forward-pointing head: the same triangle language as the threats.
    g.fillTriangle(20, 1, 24, 5.5, 20, 10);
    g.fillStyle(Palette.wardenAccent, 1);
    g.fillTriangle(0, 1, 5, 5.5, 0, 10);
  });

  // --- Stations -----------------------------------------------------------

  draw(scene, 'station-timber-stack', 52, 46, (g) => {
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(2, 16, 48, 26, 4);
    g.fillStyle(Palette.timber, 1);
    for (let i = 0; i < 3; i++) g.fillCircle(12 + i * 14, 20, 7);
    for (let i = 0; i < 2; i++) g.fillCircle(19 + i * 14, 8, 7);
    g.fillStyle(Palette.ochre, 0.8);
    for (let i = 0; i < 3; i++) g.fillCircle(12 + i * 14, 20, 3);
    for (let i = 0; i < 2; i++) g.fillCircle(19 + i * 14, 8, 3);
  });

  draw(scene, 'station-timber-stack-empty', 52, 46, (g) => {
    g.fillStyle(Palette.timberDark, 0.8);
    g.fillRoundedRect(2, 30, 48, 12, 4);
    g.lineStyle(2, Palette.blockedRust, 0.7);
    g.strokeRoundedRect(2, 30, 48, 12, 4);
  });

  const bench = (g: Phaser.GameObjects.Graphics, accent: number, accentAlpha: number) => {
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(2, 18, 48, 24, 3);
    g.fillStyle(Palette.timber, 1);
    g.fillRoundedRect(4, 12, 44, 10, 3);
    g.fillStyle(Palette.stoneLight, 1);
    // Saw, held upright so the bench reads as a carpentry station at a glance.
    g.fillRect(30, 2, 3, 12);
    g.fillTriangle(12, 12, 30, 4, 30, 12);
    g.fillStyle(accent, accentAlpha);
    g.fillRoundedRect(6, 34, 40, 5, 2);
  };
  draw(scene, 'station-carpenter-bench', 52, 46, (g) => bench(g, Palette.stoneDark, 0.5));
  draw(scene, 'station-carpenter-bench-ready', 52, 46, (g) => bench(g, Palette.readyGold, 0.95));
  draw(scene, 'station-carpenter-bench-active', 52, 46, (g) => bench(g, Palette.rewardGold, 1));

  const gate = (g: Phaser.GameObjects.Graphics, damage: number) => {
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(0, 0, 108, 56);
    g.fillStyle(Palette.stoneBase, 1);
    g.fillRect(4, 4, 26, 48);
    g.fillRect(78, 4, 26, 48);
    // The arch motif that repeats across every chapter.
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(30, 8, 48, 44, { tl: 22, tr: 22, bl: 2, br: 2 });
    g.fillStyle(Palette.timber, 1 - damage * 0.35);
    g.fillRoundedRect(33, 11, 42, 40, { tl: 19, tr: 19, bl: 2, br: 2 });
    g.fillStyle(Palette.timberDark, 0.85);
    g.fillRect(36, 24, 36, 3);
    g.fillRect(36, 36, 36, 3);

    if (damage > 0) {
      g.fillStyle(Palette.ink, 0.9);
      g.fillTriangle(44, 14, 56, 30, 40, 34);
      if (damage > 1) {
        g.fillTriangle(60, 20, 72, 46, 54, 40);
        g.fillTriangle(34, 38, 48, 50, 33, 51);
      }
    }
  };
  draw(scene, 'station-gate', 108, 56, (g) => gate(g, 0));
  draw(scene, 'station-gate-damaged', 108, 56, (g) => gate(g, 1));
  draw(scene, 'station-gate-critical', 108, 56, (g) => gate(g, 2));
  draw(scene, 'station-gate-destroyed', 108, 56, (g) => {
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRect(0, 0, 108, 56);
    g.fillStyle(Palette.stoneBase, 1);
    g.fillRect(4, 4, 26, 48);
    g.fillRect(78, 4, 26, 48);
    g.fillStyle(Palette.ink, 1);
    g.fillRect(30, 6, 48, 50);
    g.fillStyle(Palette.timberDark, 1);
    g.fillTriangle(30, 56, 44, 30, 46, 56);
    g.fillTriangle(64, 56, 70, 34, 78, 56);
  });

  draw(scene, 'station-armoury', 52, 46, (g) => {
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(4, 6, 44, 36, 3);
    g.fillStyle(Palette.stoneDark, 0.7);
    g.fillRect(6, 20, 40, 3);
    g.fillStyle(Palette.stoneLight, 1);
    for (let i = 0; i < 4; i++) {
      g.fillRect(10 + i * 9, 8, 3, 12);
      g.fillTriangle(10 + i * 9, 8, 13 + i * 9, 8, 11.5 + i * 9, 3);
    }
    g.fillStyle(Palette.parchment, 0.9);
    g.fillRoundedRect(8, 26, 36, 12, 2);
  });

  draw(scene, 'station-armoury-empty', 52, 46, (g) => {
    g.fillStyle(Palette.timberDark, 0.85);
    g.fillRoundedRect(4, 6, 44, 36, 3);
    g.fillStyle(Palette.stoneDark, 0.7);
    g.fillRect(6, 20, 40, 3);
    g.lineStyle(2, Palette.blockedRust, 0.6);
    g.strokeRoundedRect(4, 6, 44, 36, 3);
  });

  const ballista = (g: Phaser.GameObjects.Graphics, state: 'idle' | 'loading' | 'ready') => {
    g.fillStyle(Palette.timberDark, 1);
    g.fillRoundedRect(6, 26, 40, 16, 3);
    g.fillStyle(Palette.stoneDark, 1);
    g.fillCircle(14, 42, 5);
    g.fillCircle(38, 42, 5);
    // Bow arms sweep forward: the silhouette points where it will shoot.
    g.lineStyle(4, Palette.timber, 1);
    g.beginPath();
    g.moveTo(6, 20);
    g.lineTo(26, 8);
    g.lineTo(46, 20);
    g.strokePath();
    g.fillStyle(Palette.timber, 1);
    g.fillRect(23, 8, 6, 26);

    if (state === 'ready') {
      g.fillStyle(Palette.parchment, 1);
      g.fillRect(24, 2, 4, 14);
      g.fillTriangle(22, 4, 30, 4, 26, -3);
      g.lineStyle(2, Palette.readyGold, 0.95);
      g.strokeRoundedRect(4, 24, 44, 20, 4);
    } else if (state === 'loading') {
      g.lineStyle(2, Palette.readyGold, 0.45);
      g.strokeRoundedRect(4, 24, 44, 20, 4);
    }
  };
  draw(scene, 'station-ballista', 52, 48, (g) => ballista(g, 'idle'));
  draw(scene, 'station-ballista-loading', 52, 48, (g) => ballista(g, 'loading'));
  draw(scene, 'station-ballista-ready', 52, 48, (g) => ballista(g, 'ready'));

  const bell = (g: Phaser.GameObjects.Graphics, ringing: boolean) => {
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRoundedRect(8, 52, 56, 14, 3);
    g.fillStyle(Palette.stoneBase, 1);
    g.fillRect(12, 14, 7, 40);
    g.fillRect(53, 14, 7, 40);
    g.fillRect(10, 8, 52, 8);
    g.fillStyle(ringing ? Palette.rewardGold : Palette.ochre, 1);
    // Bell: the motif the whole fortress is named for.
    g.fillRoundedRect(24, 20, 24, 24, { tl: 12, tr: 12, bl: 3, br: 3 });
    g.fillRect(21, 42, 30, 5);
    g.fillStyle(ringing ? Palette.parchment : Palette.timberDark, 1);
    g.fillCircle(36, 50, 3);
    if (ringing) {
      g.lineStyle(2, Palette.rewardGold, 0.55);
      g.strokeCircle(36, 33, 30);
      g.lineStyle(2, Palette.rewardGold, 0.3);
      g.strokeCircle(36, 33, 38);
    }
  };
  draw(scene, 'station-bell', 72, 70, (g) => bell(g, false));
  draw(scene, 'station-bell-ringing', 72, 70, (g) => bell(g, true));

  // --- Threats ------------------------------------------------------------
  // Hostile shape language: forward-pointing triangles and compressed poses.

  draw(scene, 'enemy-raider', 22, 26, (g) => {
    g.fillStyle(Palette.danger, 1);
    g.fillTriangle(11, 0, 21, 16, 1, 16);
    g.fillRect(4, 14, 14, 11);
    g.fillStyle(Palette.ink, 0.75);
    g.fillRect(7, 17, 8, 3);
  });

  draw(scene, 'enemy-ram', 40, 30, (g) => {
    g.fillStyle(Palette.stoneDark, 1);
    g.fillRoundedRect(6, 10, 32, 16, 3);
    g.fillStyle(Palette.timberDark, 1);
    g.fillRect(2, 14, 30, 8);
    g.fillStyle(Palette.danger, 1);
    g.fillTriangle(0, 10, 0, 26, 14, 18);
    g.fillStyle(Palette.ink, 0.6);
    g.fillCircle(14, 27, 4);
    g.fillCircle(32, 27, 4);
  });

  // --- Effects and world markers ------------------------------------------

  draw(scene, 'spark', 8, 8, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 3.4);
  });

  draw(scene, 'destination-pip', 30, 30, (g) => {
    g.lineStyle(2, Palette.readyGold, 0.95);
    g.strokeCircle(15, 15, 11);
    g.fillStyle(Palette.readyGold, 0.9);
    g.fillCircle(15, 15, 3.2);
  });

  draw(scene, 'threat-marker', 34, 40, (g) => {
    g.fillStyle(Palette.danger, 0.9);
    g.fillTriangle(17, 34, 3, 8, 31, 8);
    g.fillStyle(Palette.ink, 1);
    g.fillRect(15, 14, 4, 10);
    g.fillRect(15, 26, 4, 4);
  });

  // A worn patch where boots have stood, not an outlined box.
  draw(scene, 'slot-marker', 30, 22, (g) => {
    g.fillStyle(Palette.groundLight, 1);
    g.fillEllipse(15, 11, 26, 16);
    g.fillStyle(Palette.groundBase, 1);
    g.fillEllipse(15, 11, 16, 9);
  });
}

/** Draws into an offscreen Graphics and bakes it into a texture. */
function draw(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  paint: (g: Phaser.GameObjects.Graphics) => void,
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  paint(g);
  g.generateTexture(key, width, height);
  g.destroy();
}
