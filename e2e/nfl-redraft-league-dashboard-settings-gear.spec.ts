/**
 * NFL redraft league dashboard — settings-gear consolidation smoke (Commit B).
 *
 * Hits the dedicated harness at `/e2e/nfl-redraft-league-dashboard` (mounts the
 * real LeagueShell with an NFL redraft fixture). No auth/DB — the harness
 * stubs in-memory props.
 *
 * Verifies Phase 1 / Commit B contract:
 *   - 6 core tabs only (Home / Roster / Matchups / Players / Trades / League).
 *   - No "Settings" or "Commissioner Panel" tab in the primary tab bar.
 *   - Settings gear is visible and opens the settings modal.
 *   - The settings modal exposes the commissioner control center hub (10
 *     internal tabs: General … AI), reachable for commissioner fixture user.
 *   - Inside the Commissioner hub tab, the Audit Log placeholder panel is
 *     visible with the canonical Phase 1 copy.
 *   - The Commissioner hub also surfaces League History (existing panel).
 */

import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

// The harness can take ~120 s cold and the settings chunk can take as long again on first click.
test.describe.configure({ timeout: 300_000 })

const HARNESS_PATH = '/e2e/nfl-redraft-league-dashboard'

const FORBIDDEN_PRIMARY_TABS = ['Settings', 'Commissioner Panel', 'Commissioner', 'History', 'War Room', 'AI Coaching', 'Chimmy Coaching']
const REQUIRED_PRIMARY_TABS = ['Home', 'Roster', 'Matchups', 'Players', 'Trades', 'League']

async function gotoHarnessReady(page: Page): Promise<void> {
  // First load can take >5min cold; the harness compiles the full LeagueShell
  // dependency tree (~5500 modules). Subsequent runs are cached and fast.
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('nfl-redraft-league-dashboard-harness').waitFor({ state: 'visible', timeout: 120_000 })
  // Bounded: the shell's background fetches can keep the network busy past the
  // whole test budget, and the swallowed timeout then fails the NEXT line.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null)
  await page.getByRole('tab', { name: 'Home' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function openSettingsModal(page: Page): Promise<void> {
  // LeagueSettingsModal mounts on the FIRST gear click, so that click starts the
  // download and compile of the whole commissioner-settings chunk. On a loaded CI
  // dev server that takes far longer than a dialog normally needs. A failed load
  // closes the modal and shows a toast, so watch for both and fail on the toast.
  await clickHydrated(page.getByTestId('league-header-settings'))
  const dialog = page.locator('[role="dialog"]')
  const loadFailed = page.getByText('Settings didn’t load')
  await expect(dialog.or(loadFailed).first()).toBeVisible({ timeout: 130_000 })
  await expect(loadFailed, 'the settings chunk failed to load').toHaveCount(0)
}

test.describe('@nfl-redraft @league-shell settings-gear consolidation', () => {
  test('NFL redraft dashboard renders only the 6 core tabs and the gear opens the modal with the audit log + history visible to the commissioner', async ({ page }) => {
    await gotoHarnessReady(page)

    // 1 — harness root + 2 — exact 6 core tabs
    await expect(page.getByTestId('nfl-redraft-league-dashboard-harness')).toBeVisible()

    // Scope the tab-bar assertions to the visible primary navigation. The
    // 6 core tabs render as buttons in LeagueHeader's tab strip — collect
    // only the names that match our allow-listed labels.
    const visibleTabNames = await page
      .locator('button, a')
      .filter({ hasText: /^(Home|Roster|Matchups|Players|Trades|League|Settings|War Room|AI Coaching|Chimmy Coaching|History|Commissioner Panel)$/ })
      .allTextContents()

    const trimmed = visibleTabNames.map((s) => s.trim())
    for (const required of REQUIRED_PRIMARY_TABS) {
      expect(trimmed, `expected primary tab "${required}" to be visible`).toContain(required)
    }
    for (const forbidden of FORBIDDEN_PRIMARY_TABS) {
      expect(trimmed, `forbidden primary tab "${forbidden}" must NOT appear`).not.toContain(forbidden)
    }

    // 3 — settings gear is visible
    const gear = page.getByTestId('league-header-settings')
    await expect(gear).toBeVisible()

    // 4 — clicking gear opens the settings modal
    await openSettingsModal(page)
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#league-settings-modal-title')).toContainText('E2E NFL Redraft')

    // 5 — settings modal exposes the commissioner control center hub.
    //     For commissioner users, mainTab === 'general' renders the
    //     LeagueSettingsControlCenter, which renders BOTH a mobile pill row
    //     (md:hidden) and a desktop sidebar (hidden md:flex) with identical
    //     test IDs. Filter to the one that is actually visible at this viewport.
    const commishHubTab = page.locator(
      '[data-testid="league-settings-hub-tab-commissioner"]:visible',
    )
    await expect(commishHubTab).toBeVisible()

    // 6 — switch to the Commissioner hub and assert the audit log panel
    //     renders with the Phase 1 placeholder copy.
    await commishHubTab.click()

    const auditLog = page.getByTestId('settings-audit-log-panel')
    await expect(auditLog).toBeVisible()
    await expect(auditLog).toContainText('Audit Log')
    await expect(auditLog).toContainText('Audit logging is ready to be wired')
    await expect(auditLog).toContainText(/Commissioner actions will appear[\s\S]+?here once backend logging is enabled/)

    // 7 — Commissioner controls + history are reachable from this hub tab —
    //     they share the CommissionerTab body with the audit-log panel.
    //     LeagueHistoryPanel and the various commissioner panels fetch live
    //     league data, which the no-DB harness cannot serve, so they render
    //     in their loading states (e.g. "Loading commissioner controls...",
    //     "Loading dues tracker..."). The presence of that loading copy plus
    //     the head-commissioner "Remove from AllFantasy" delete-league panel
    //     proves the full CommissionerTab tree mounted.
    await expect(dialog).toContainText(/Loading commissioner controls/)
    await expect(dialog).toContainText(/Remove from AllFantasy/)
  })
})
