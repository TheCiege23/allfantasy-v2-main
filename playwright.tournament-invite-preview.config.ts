import { defineConfig, devices } from '@playwright/test'

// Runs only synthetic tournament previews. The local-only URL cannot reach a real database.
const localDatabase = 'postgresql://preview:preview@127.0.0.1:65432/preview'
const mobile = /[\\/]e2e[\\/]mobile[\\/].*tournament-invite-readiness\.spec\.ts$/

export default defineConfig({
  testDir: './e2e',
  testMatch: /tournament-invite-readiness\.spec\.ts$/,
  timeout: 120_000,
  reporter: 'list',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: mobile },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] }, testMatch: mobile },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] }, testMatch: mobile },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev -p 3107 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3107/dev/tournament-invite-readiness?view=invite',
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: localDatabase,
      DIRECT_URL: localDatabase,
      NEXTAUTH_SECRET: 'synthetic-preview-only-never-for-real-accounts',
      AF_NEXT_DIST_DIR: '.next-tournament-invite-preview',
    },
  },
})
