import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4329', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npx tsx server/main.ts',
    url: 'http://127.0.0.1:4329/api/sessions',
    env: {
      AGENT_PROGRESS_PORT: '4329',
      AGENT_PROGRESS_HOME: `.agent-progress/ui-tests-${randomUUID()}`,
    },
    reuseExistingServer: false,
  },
});
