import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@tzmeet/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) }
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/test/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30000
  }
});
