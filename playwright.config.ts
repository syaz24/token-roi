import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * E2E runs against a throwaway database seeded from the repo fixtures, so it
 * never reads or writes your real indexed data.
 */
// A unique database per run. Reusing one file let projects, subscriptions and
// value entries accumulate across runs, which made assertions pass or fail
// depending on how many times the suite had been run before.
const E2E_DB = path.join(process.cwd(), '.e2e', `e2e-${Date.now()}.db`);
const FIXTURES = path.join(process.cwd(), 'fixtures');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4784',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx next dev -H 127.0.0.1 -p 4784',
    url: 'http://127.0.0.1:4784',
    // Never reuse: a running server would keep pointing at the previous run's
    // database, defeating the per-run isolation above.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      TOKEN_ROI_DB: E2E_DB,
      TOKEN_ROI_CLAUDE_ROOT: path.join(FIXTURES, 'claude-code'),
      TOKEN_ROI_CODEX_ROOT: path.join(FIXTURES, 'codex'),
      TOKEN_ROI_GEMINI_ROOT: path.join(FIXTURES, 'gemini-root'),
    },
  },
});
