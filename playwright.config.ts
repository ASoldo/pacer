import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'https://127.0.0.1:5173'
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    launchOptions: {
      executablePath: chromiumExecutable,
      args: ['--ignore-certificate-errors', '--allow-insecure-localhost'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1920, height: 1030 },
      },
    },
    {
      name: 'phone-portrait',
      use: {
        viewport: { width: 412, height: 915 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'phone-landscape',
      use: {
        viewport: { width: 915, height: 412 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'tablet',
      use: {
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
})
