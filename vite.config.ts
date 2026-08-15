import { defineConfig } from 'vite';

// ECHOHOLD ships as a static, offline-capable PWA. Relative base keeps it
// working from a subdirectory (GitHub Pages, itch.io zip, local file server).
export default defineConfig({
  base: './',
  publicDir: 'public',
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
