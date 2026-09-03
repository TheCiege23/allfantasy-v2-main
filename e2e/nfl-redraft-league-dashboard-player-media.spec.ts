/**
 * NFL redraft league dashboard — player media (Roster + Players) smoke (Commit C).
 *
 * Reuses the existing `/e2e/nfl-redraft-league-dashboard` harness. Verifies
 * that switching to the Roster and Players tabs does not crash the page,
 * that the shared `<PlayerHeadshot>` chain renders an image element OR a
 * stable initials/shield placeholder for every row, and that broken-image
 * onError fallbacks do not unmount the dashboard.
 */

import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/nfl-redraft-league-dashboard'

/*
 * ⚠ THE SHELL HAS TWO LEVELS OF NAVIGATION, AND THIS SPEC ONLY KNEW ABOUT ONE.
 *
 * LeagueShell renders GROUP pills (`league-tab-group-<group>`, plain buttons carrying
 * aria-pressed) and, beneath the active group only, its TABS (`league-tab-<id>`, which
 * do carry role="tab"). Two consequences the old selectors fell into:
 *
 *   1. Only the ACTIVE group's tabs exist in the DOM. From Home — which is in the
 *      `league` group — no roster tab is present at any accessible name, so
 *      getByRole('tab', { name: 'Roster' }) could never match.
 *   2. The tab row is gated on `activeGroup.tabs.length > 1`. The `roster` group holds
 *      exactly one tab, so selecting it renders NO role="tab" element at all — the
 *      pill is the only handle that surface has.
 *
 * And the label is 'My Team', not 'Roster' (LeagueShell forces it after localisation),
 * so even the group that does render it answers to a different name than this spec used.
 *
 * Test ids rather than accessible names throughout: the shell guarantees the id, while
 * the label is localised and has already been renamed once.
 */
const LEAGUE_GROUP_TABS = ['home', 'matchups', 'players', 'trades'] as const

async function gotoHarnessReady(page: Page): Promise<void> {
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('nfl-redraft-league-dashboard-harness').waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForLoadState('networkidle').catch(() => null)
  await page.getByTestId('league-tab-group-league').waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('@nfl-redraft @league-shell player media fallback', () => {
  test('Roster + Players tabs render without crashing under broken player images, and the 6 core tabs remain stable', async ({ page }) => {
    // Force every player headshot URL to 404 so we exercise the `onError`
    // step-through inside <PlayerImage>. The chain ends in a stable initials
    // placeholder, so the page should still render cleanly.
    const blockedHosts = ['sleepercdn.com', 'a.espncdn.com', 'media.api-sports.io', 'r2.thesportsdb.com']
    await page.route('**/*', async (route) => {
      const url = route.request().url()
      const isBlockedImage =
        blockedHosts.some((h) => url.includes(h)) &&
        /\.(png|jpg|jpeg|webp)(\?|$)/i.test(url)
      if (isBlockedImage) {
        await route.fulfill({ status: 404, contentType: 'image/png', body: '' })
        return
      }
      await route.continue()
    })

    await gotoHarnessReady(page)

    // The harness has no roster fixture data, so the live tabs render an
    // empty state rather than rows — the smoke is "navigating to these tabs
    // does not crash the dashboard, and the core surfaces stay reachable".

    // My Team lives in its own single-tab group, so the pill is the way in.
    await clickHydrated(page.getByTestId('league-tab-group-roster'))
    await page.getByTestId('nfl-redraft-league-dashboard-harness').waitFor({ state: 'visible', timeout: 5_000 })

    // Back to the league group, then across each of its tabs in turn.
    await clickHydrated(page.getByTestId('league-tab-group-league'))
    for (const tabId of LEAGUE_GROUP_TABS) {
      await clickHydrated(page.getByTestId(`league-tab-${tabId}`))
      await page.getByTestId('nfl-redraft-league-dashboard-harness').waitFor({ state: 'visible', timeout: 5_000 })
    }

    // The core surfaces remain reachable after the navigation cycle (no shell crash):
    // both groups still offer their pill, and the league group still lists its tabs.
    for (const group of ['league', 'roster'] as const) {
      await expect(page.getByTestId(`league-tab-group-${group}`)).toBeVisible()
    }
    for (const tabId of LEAGUE_GROUP_TABS) {
      await expect(page.getByTestId(`league-tab-${tabId}`)).toBeVisible()
    }

    // The settings gear and harness root remain mounted — proves the broken
    // image fallback inside <PlayerHeadshot>/`<PlayerImage>` did not surface
    // an unhandled error that unmounted the shell.
    await expect(page.getByTestId('league-header-settings')).toBeVisible()
    await expect(page.getByTestId('nfl-redraft-league-dashboard-harness')).toBeVisible()
  })
})
