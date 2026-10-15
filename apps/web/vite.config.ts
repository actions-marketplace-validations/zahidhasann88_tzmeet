import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@tzmeet/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) } },
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  // GitHub Pages project sites are served from /<repo>/; root hosting leaves this unset.
  base: process.env.TZMEET_BASE_PATH ? `${process.env.TZMEET_BASE_PATH}/` : '/',
  build: { outDir: 'out', emptyOutDir: true }
});
