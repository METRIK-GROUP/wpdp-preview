// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'node tests/servidor.mjs',
    url: 'http://localhost:4173/confirmado/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'computador', use: { ...devices['Desktop Chrome'] } },
  ],
});
