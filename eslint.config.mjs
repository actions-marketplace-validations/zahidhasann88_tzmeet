import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.wrangler/**', '**/out/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'process', 'child_process'] }],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require', 'fetch', 'XMLHttpRequest', 'WebSocket']
    }
  },
  {
    files: ['packages/api/src/**/*.ts'],
    ignores: ['packages/api/src/node.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'os', 'process', 'child_process'] }],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require']
    }
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'os', 'process', 'child_process'] }],
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require']
    }
  }
);
