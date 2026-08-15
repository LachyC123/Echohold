import { defineConfig } from 'vitest/config';

// The simulation core is deliberately free of Phaser imports so it can be
// tested in a plain Node environment. Only the presentation layer needs a DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['default'],
  },
});
