import { defineConfig, type Plugin } from 'vite';

/**
 * Emits the list of built assets for the service worker to precache.
 *
 * Bundle filenames are content-hashed, so a hand-written worker cannot know
 * them. Without this the first offline visit fails: the worker only activates
 * after the page has already fetched its scripts, so nothing is in the cache
 * yet. Writing the manifest at build time makes one online visit enough.
 */
function serviceWorkerManifest(): Plugin {
  return {
    name: 'echohold-sw-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => !fileName.endsWith('.map'))
        .map((fileName) => `./${fileName}`);

      this.emitFile({
        type: 'asset',
        fileName: 'sw-manifest.json',
        source: JSON.stringify(
          { generatedFor: 'echohold', assets: ['./', './index.html', './manifest.webmanifest', ...assets] },
          null,
          2,
        ),
      });
    },
  };
}

// ECHOHOLD ships as a static, offline-capable PWA. Relative base keeps it
// working from a subdirectory (GitHub Pages, itch.io zip, local file server).
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [serviceWorkerManifest()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
