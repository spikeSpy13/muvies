import { defineConfig } from '@playwright/test';
import chromium from '@sparticuz/chromium';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1100 },
    launchOptions: process.platform === 'linux' ? {
      executablePath: await chromium.executablePath(),
      args: chromium.args.filter(arg => !['--single-process', '--disable-web-security', '--allow-running-insecure-content'].includes(arg)),
      env: { ...process.env, XDG_CACHE_HOME: '/tmp/muvies-browser-cache' },
    } : {},
  },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
