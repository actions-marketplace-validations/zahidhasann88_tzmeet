import { defineConfig, devices } from '@playwright/test';

const external = process.env.TZMEET_E2E_URL;
const basePath = process.env.TZMEET_E2E_BASE_PATH ?? '';
const localURL = `http://127.0.0.1:4190${basePath}/`;
const skipBuild = process.env.TZMEET_E2E_SKIP_BUILD === '1';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: { baseURL: external ?? localURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1040 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: external ? undefined : {
    command: `${skipBuild ? '' : 'pnpm build && '}node scripts/serve.mjs out 4190`,
    url: localURL,
    reuseExistingServer: false,
    timeout: 180000,
    env: { TZMEET_BASE_PATH: basePath, TZMEET_STATIC_BASE: basePath }
  }
});
