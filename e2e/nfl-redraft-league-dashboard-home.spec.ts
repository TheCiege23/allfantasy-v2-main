import { expect, test, type Page } from '@playwright/test'
import { clickHydrated } from './helpers/hydration'

test.describe.configure({ timeout: 180_000 })

const HARNESS_PATH = '/e2e/nfl-redraft-league-dashboard'

/*
 * The shell's internal fetches 404 in dev and can keep the network busy. An unbounded
 * networkidle wait used the whole 180s test budget, so bound it and rely on the test-id
 * waits for readiness.
 */
const NETWORK_IDLE_TIMEOUT_MS = 10_000

/*
 * ⚠ THIS SPEC USED TO WAIT FOR A SCREEN THIS HARNESS CANNOT REACH.
 *
 * Every id it asserted — league-draftboard-card, league-invite-copy,
 * nfl-redraft-predraft-summary, nfl-redraft-draft-order and friends — lives only in
 * app/league/[leagueId]/tabs/DraftTab.tsx. Two independent reasons none of them could
 * ever appear here, either of which alone is fatal:
 *
 *   1. The shell opens on tabDefs[0], which is `home`, and Home renders
 *      NflRedraftLeagueHomeDashboard (`g32-nfl-redraft-home`). The nflRedraftCore
 *      predraft-landing effect explicitly opts out of redirecting to Draft, so nothing
 *      navigates there on its own.
 *   2. Even on the Draft tab, this harness fixture is `lifecycleState: 'pre_draft'`, and
 *      that case short-circuits to renderPredraftDraftSetup() BEFORE DraftTab is
 *      reached. DraftTab does not render at all in a pre-draft league.
 *
 * So the spec sat on `league-draftboard-card` until the 30s waitFor gave up, and
 * reported a timeout — which reads as a dashboard that failed to load rather than as a
 * spec pointed at the wrong screen.
 *
 * What it asserts now is the journey its own title describes, against the two surfaces
 * that genuinely exist: Home stays put on the dashboard, and the Draft group shows the
 * pre-draft setup card. Labels below are the ones the shell actually renders — note
 * 'Rounds / timer', which the old spec called 'Pick timer'.
 */
async function gotoHarnessReady(page: Page): Promise<void> {
  await page.goto(HARNESS_PATH, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('nfl-redraft-league-dashboard-harness').waitFor({ state: 'visible', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => null)
  await page.getByTestId('g32-nfl-redraft-home').waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('@nfl-redraft @league-shell pre-draft-home', () => {
  test('Home keeps the user on the league dashboard and shows the pre-draft setup surface', async ({ page }) => {
    await gotoHarnessReady(page)

    // Landing on Home must not bounce the user anywhere — the whole point of the
    // predraft-landing opt-out is that a pre-draft league still opens on its dashboard.
    // The shell mirrors the active tab into ?view=, so Home reads as ?view=home.
    await expect
      .poll(() => {
        const url = new URL(page.url())
        return { path: url.pathname, view: url.searchParams.get('view') ?? 'home' }
      })
      .toEqual({ path: HARNESS_PATH, view: 'home' })
    await expect(page.getByTestId('g32-nfl-redraft-home')).toBeVisible()

    // The Draft group's first tab is `draft`, which in a pre-draft league is the setup card.
    await clickHydrated(page.getByTestId('league-tab-group-draft'))

    const setupCard = page.getByTestId('league-command-center-card')
    await expect(setupCard).toBeVisible()
    await expect(setupCard).toContainText('Draft setup')
    for (const field of ['League fill', 'Draft date', 'Draft type', 'Rounds / timer']) {
      await expect(setupCard).toContainText(field)
    }

    // The three affordances a commissioner has before a draft exists. This fixture is
    // `isCommissioner: true`, which is what makes the settings button render.
    await expect(page.getByTestId('predraft-open-draft-room')).toBeVisible()
    await expect(page.getByTestId('predraft-open-draft-settings')).toBeVisible()
    await expect(page.getByTestId('predraft-start-mock-draft')).toBeVisible()
  })
})
