import { defineConfig, devices } from '@playwright/test';

// E2E テスト。Expo の web 向けの書き出し（dist/）を、Pixel と同じ 412×915 の画面の Chromium で操作する。
// 先に npm run e2e:build で書き出しておく。手順と、web では確かめられないことは e2e/README.md にある
const PORT = Number(process.env.E2E_PORT ?? 8090);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // 過去の日の記録を画面の操作で作るテストがあるので、少し長めにする
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // 不安定なテストを隠さないよう、やり直しはしない
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'pixel-chromium' }],
  webServer: {
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
