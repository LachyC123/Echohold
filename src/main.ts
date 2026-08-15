import Phaser from 'phaser';
import { CONTEXT_KEY, GameContext } from './GameContext';
import { computeViewHeight, DESIGN_WIDTH, IS_DEV, Palette, SceneKeys } from './config/gameConfig';
import { BootScene } from './scenes/BootScene';
import { HubScene } from './scenes/HubScene';
import { ScenarioScene } from './scenes/ScenarioScene';
import { TimelineReviewScene } from './scenes/TimelineReviewScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './scenes/UIScene';
import { installDevBridge } from './dev/devBridge';

/**
 * Application shell.
 *
 * Responsibilities kept here and nowhere else: creating the Phaser game,
 * portrait framing, safe-area handling, background/foreground pause, and
 * surfacing a boot failure as readable text rather than a black screen.
 */

function reportBootFailure(error: unknown): void {
  const detail = document.getElementById('boot-error-detail');
  if (detail) {
    detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  document.body.classList.add('eh-boot-failed');
  console.error('[echohold] boot failed', error);
}

function applyOrientationClass(): void {
  // Portrait only during gameplay; the shell shows the rotate request.
  const landscape = window.innerWidth > window.innerHeight * 1.05;
  document.body.classList.toggle('eh-landscape', landscape);
}

function applySafeAreaPadding(game: Phaser.Game): void {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => Number.parseFloat(style.getPropertyValue(name) || '0') || 0;
  game.registry.set('safeArea', {
    top: read('--sat'),
    bottom: read('--sab'),
  });
}

function start(): void {
  const context = new GameContext();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    backgroundColor: Palette.ink,
    // Portrait-first. The width is fixed and the height is derived from this
    // device's aspect, so a tall phone gets the extra courtyard rather than
    // two thick letterbox bars. FIT then handles the residual fraction.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: DESIGN_WIDTH,
      height: computeViewHeight(),
    },
    // Capped on mobile because fill rate, not CPU, is the bottleneck.
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: 'high-performance',
    },
    dom: { createContainer: false },
    banner: false,
    audio: { noAudio: true }, // audio is synthesised by AudioService
    scene: [BootScene, TitleScene, HubScene, ScenarioScene, UIScene, TimelineReviewScene],
  });

  game.registry.set(CONTEXT_KEY, context);
  game.scale.setZoom(1);

  const cap = () => Math.min(window.devicePixelRatio || 1, context.quality.pixelRatioCap);
  game.registry.set('pixelRatioCap', cap());

  // Background/foreground: pause the simulation and suspend audio, then
  // require an explicit resume rather than replaying the missed seconds.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      context.audio.suspend();
      game.events.emit('echohold:hidden');
    } else {
      context.audio.resume();
      game.events.emit('echohold:visible');
    }
  });

  window.addEventListener('resize', () => {
    applyOrientationClass();
    applySafeAreaPadding(game);
  });
  window.addEventListener('orientationchange', applyOrientationClass);
  applyOrientationClass();
  applySafeAreaPadding(game);

  // Unlock audio on the first genuine gesture, as browsers require.
  const unlock = () => {
    context.audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  if (IS_DEV) installDevBridge(game, context);

  // Register the offline shell only in production; in development it would
  // serve stale bundles and hide real errors.
  if (!IS_DEV && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Served verbatim from public/ so it keeps a root-level scope; a bundled
      // worker would land under /assets/ and be unable to claim the page.
      const workerUrl = new URL('sw.js', document.baseURI);
      navigator.serviceWorker.register(workerUrl, { scope: './' }).catch((error) => {
        console.warn('[echohold] offline shell unavailable', error);
      });
    });
  }

  window.addEventListener('error', (event) => {
    console.error('[echohold] uncaught error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[echohold] unhandled rejection', event.reason);
  });
}

try {
  start();
} catch (error) {
  reportBootFailure(error);
}

export { SceneKeys };
