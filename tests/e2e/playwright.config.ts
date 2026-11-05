/**
 * Navidrome MCP Server - e2e Playwright config
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Playwright loads this file once per process, so it makes no temp folder or process here.
 * globalSetup starts the one instance the run shares.
 */

import { defineConfig, devices } from '@playwright/test';

// Playwright loads this file by its path, which the export analysis cannot see.
// ts-unused-exports:disable-next-line
export default defineConfig({
  testDir: 'specs',
  testMatch: '**/*.e2e.ts',
  // Every test drives the one instance and its one mpv.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: process.env['CI'] !== undefined,
  // A test chains page loads, event-stream updates and mpv startup.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './harness/global-setup.ts',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
