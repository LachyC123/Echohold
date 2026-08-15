import type Phaser from 'phaser';
import type { GameContext } from '../GameContext';
import { SceneKeys } from '../config/gameConfig';
import type { ScenarioScene } from '../scenes/ScenarioScene';

export interface DevSnapshot {
  scene: string;
  tick: number;
  runNumber: number;
  remainingSeconds: number;
  actorCount: number;
  enemyCount: number;
  reservationCount: number;
  listenerCount: number;
  gateHealth: number | null;
  trackCount: number;
  objectives: Array<{ id: string; complete: boolean; impossible: boolean; text: string }>;
}

/**
 * Read-only state bridge for development and automated checks.
 *
 * Deliberately exposes snapshots and a safe reset only - never a way to grant
 * resources or complete an objective. The production build never installs it,
 * and no scenario is allowed to depend on it to be understood (design document
 * section 32).
 */
export function installDevBridge(game: Phaser.Game, context: GameContext): void {
  const activeScenario = (): ScenarioScene | null => {
    const scene = game.scene.getScene(SceneKeys.Scenario);
    return scene && game.scene.isActive(SceneKeys.Scenario) ? (scene as ScenarioScene) : null;
  };

  const bridge = {
    /** Design-space canvas size, for mapping automated taps to game space. */
    design(): { width: number; height: number } {
      return { width: game.scale.width, height: game.scale.height };
    },

    activeScenes(): string[] {
      return game.scene.getScenes(true).map((scene) => scene.scene.key);
    },

    /**
     * World-to-design-space projection, so an automated check can drive the
     * real pointer path rather than calling into the simulation directly.
     */
    project(worldX: number, worldY: number): { x: number; y: number } | null {
      const scene = activeScenario();
      if (!scene) return null;
      // Phaser zooms about the camera midpoint, so a plain scroll-and-scale
      // projection is wrong at any zoom other than 1.
      const camera = scene.cameras.main;
      const centreX = camera.width / 2;
      const centreY = camera.height / 2;
      return {
        x: (worldX - camera.scrollX - centreX) * camera.zoom + centreX,
        y: (worldY - camera.scrollY - centreY) * camera.zoom + centreY,
      };
    },

    /** Recorded tracks, so a check can see exactly what an Echo will repeat. */
    tracks() {
      const scene = activeScenario();
      if (!scene) return [];
      return scene.simulation.getTracks().map((track) => ({
        id: track.id,
        label: track.label ?? null,
        commands: track.commands.map((command) => ({
          type: command.type,
          targetId: command.targetId ?? null,
          issuedTick: command.issuedTick,
          maxRunTicks: command.maxRunTicks ?? null,
        })),
      }));
    },

    /** The run in progress, before it is sealed into a track. */
    recording() {
      const scene = activeScenario();
      if (!scene) return [];
      return scene.simulation.recorder.peek().map((command) => ({
        type: command.type,
        targetId: command.targetId ?? null,
        issuedTick: command.issuedTick,
        maxRunTicks: command.maxRunTicks ?? null,
      }));
    },

    /** Station positions by id, for locating a tap target. */
    stations(): Array<{ id: string; x: number; y: number }> {
      const scene = activeScenario();
      if (!scene) return [];
      return Array.from(scene.simulation.getWorld().stations.values()).map((station) => ({
        id: station.id,
        x: station.position.x,
        y: station.position.y,
      }));
    },

    snapshot(): DevSnapshot | null {
      const scene = activeScenario();
      if (!scene) {
        return {
          scene: game.scene.getScenes(true).map((s) => s.scene.key).join(','),
          tick: 0,
          runNumber: 0,
          remainingSeconds: 0,
          actorCount: 0,
          enemyCount: 0,
          reservationCount: 0,
          listenerCount: 0,
          gateHealth: null,
          trackCount: 0,
          objectives: [],
        };
      }
      return scene.devSnapshot();
    },

    /** Disposes the current scenario and returns to the hub. */
    reset(): void {
      activeScenario()?.abandonToHub();
    },

    save() {
      return context.save;
    },

    clearSave(): void {
      context.saves.reset();
    },
  };

  (window as unknown as { echohold?: typeof bridge }).echohold = bridge;
}
