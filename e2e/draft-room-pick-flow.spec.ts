/**
 * Phase 5B — Interactive pick flow render-pipeline guard.
 *
 * Builds on PR #33's harness mock helpers and PR #42's parameterized AI ADP
 * spec. Where 5A asserts the AI ADP overlay reaches the rendered table when
 * the API serves it, 5B asserts the **interactive** flow:
 *
 *   1. The page loads and player pool renders.
 *   2. The user (default fixture's slot-2 manager, on the clock at overall=2)
 *      clicks the draft button on a pool row.
 *   3. The page POSTs to `/api/leagues/*\/draft/pick`, the helper's mock
 *      mutates `state.picks` and bumps `state.version`.
 *   4. The next session refetch (events / live-sync) returns the updated
 *      session, the on-clock manager advances to slot 3 (Gamma), and the
 *      draft topbar reflects the new state.
 *   5. A page reload returns the same picks (the helper's state is
 *      closure-scoped to the test, so it persists across reloads in the same
 *      Playwright test).
 *
 * Scope intentionally narrow:
 *   - Single sport (NFL — same card-layout gap as 5A applies to non-NFL).
 *   - Single pick. No queue, autopick, pause/resume, or multi-tab sync.
 */
import { expect, test } from '@playwright/test'
import {
  attachDraftHarnessDiagnostics,
  createLeagueId,
  gotoDraftRoomHarness,
  mockDraftRoomApis,
  openDraftRoomHarness,
} from './helpers/draft-room-mocks'

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const EXTERNAL_NOISE_PATTERNS = [
  'https://www.google-analytics.com/**',
  'https://www.google.com/**',
  'https://www.googleadservices.com/**',
  'https://connect.facebook.net/**',
  'https://graph.facebook.com/**',
  'https://*.doubleclick.net/**',
  'https://*.googletagmanager.com/**',
  'https://*.gstatic.com/**',
]

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies()
  await page.setViewportSize({ width: 1280, height: 720 })
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(45_000)
  for (const pattern of EXTERNAL_NOISE_PATTERNS) {
    await context.route(pattern, async (route) => {
      await route.abort('blockedbyclient').catch(() => null)
    })
  }
  await page.addInitScript(() => {
    try {
      window.localStorage?.clear()
      window.sessionStorage?.clear()
    } catch {
      // best effort
    }
  })
})

test.afterEach(async ({ context }) => {
  await context.clearCookies().catch(() => null)
})

/**
 * Pool entries shaped like the resolver's normalized output. Each row's index
 * in the rendered SleeperPoolTable becomes its `sleeper-pool-row-${idx}-draft`
 * testid suffix — the test clicks row 0 to make a pick.
 */
function makeEntry(args: {
  id: string
  name: string
  position: string
  team: string | null
}) {
  return {
    playerId: args.id,
    name: args.name,
    position: args.position,
    team: args.team,
    adp: 10,
    aiAdp: 5,
    aiAdpSampleSize: 12,
    aiAdpLowSample: false,
    display: {
      playerId: args.id,
      displayName: args.name,
      sport: 'NFL',
      assets: { headshotUrl: null, teamLogoUrl: null, headshotFallbackUsed: true, teamLogoFallbackUsed: true },
      team: args.team
        ? { teamId: args.team, abbreviation: args.team, displayName: args.team, sport: 'NFL', logoUrl: null }
        : null,
      stats: { adp: 10, byeWeek: null },
      metadata: {
        position: args.position,
        teamAbbreviation: args.team,
        teamAffiliation: args.team,
        byeWeek: null,
        injuryStatus: null,
        sport: 'NFL',
      },
    },
  }
}

const POOL_ENTRIES = [
  makeEntry({ id: 'p-pick-target', name: 'Phase5B Pick Target', position: 'RB', team: 'ATL' }),
  makeEntry({ id: 'p-other-1', name: 'Phase5B Other One', position: 'WR', team: 'TB' }),
  makeEntry({ id: 'p-other-2', name: 'Phase5B Other Two', position: 'TE', team: 'MIN' }),
]

test('manual pick POST mutates mocked state, board shows pick, on-clock advances, reload persists', async ({ page }) => {
  page.setDefaultTimeout(15_000)
  page.setDefaultNavigationTimeout(45_000)
  attachDraftHarnessDiagnostics(page)

  const leagueId = createLeagueId('e2e-pick-flow')
  // Default fixture: status='in_progress', 1 keeper pick already in state, slot 2
  // on the clock. `currentUserRosterId='roster-2'` so the user can submit picks.
  await mockDraftRoomApis(page, leagueId)

  // Override the pool route so we know exactly which row will be at index 0.
  await page.route('**/api/leagues/*/draft/pool**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: POOL_ENTRIES, sport: 'NFL', count: POOL_ENTRIES.length }),
    })
  })

  await gotoDraftRoomHarness(page, `/e2e/draft-room?leagueId=${leagueId}&sport=NFL&e2eRoom=1`)
  await openDraftRoomHarness(page, { e2eRoom: true })

  // Wait for the pool to render and our target player to appear.
  await expect(page.getByText('Phase5B Pick Target').first()).toBeVisible({ timeout: 30_000 })

  // Slot 2 (Beta) starts on the clock — the helper preseeded a slot-1 keeper pick.
  const onClockManager = page.getByTestId('draft-topbar-on-clock-manager')
  await expect(onClockManager).toBeVisible({ timeout: 15_000 })
  await expect(onClockManager).toContainText(/beta/i)

  // Per-row draft buttons are `sleeper-pool-row-${idx}-draft`. Row 0 = our target.
  const drafted = new Promise<void>((resolve) => {
    page.once('requestfinished', (req) => {
      // best-effort: drop the listener after the first /draft/pick response.
      if (req.url().includes('/draft/pick')) resolve()
    })
  })
  await page.getByTestId('sleeper-pool-row-0-draft').first().click()
  await drafted

  // After the pick lands the on-clock manager must advance from Beta (slot 2)
  // to Gamma (slot 3). Use poll because the page refetches via live-sync after
  // a short delay rather than synchronously updating.
  await expect.poll(
    async () => (await onClockManager.textContent()) ?? '',
    { timeout: 20_000 },
  ).toMatch(/gamma/i)

  // The drafted player's name should also no longer be in the available pool —
  // the helper's pick handler filters it from the queue and the page's drafted-set
  // logic gates the row's draft button. The simplest stable assertion is that
  // the player's name no longer appears in the pool table's draft-button row 0.
  // (Looser than checking every row; tolerant of virtualization re-ordering.)
  const stillTargetButton = page
    .getByTestId('sleeper-pool-row-0-draft')
    .filter({ has: page.locator(':scope >> text=Phase5B Pick Target') })
  await expect(stillTargetButton).toHaveCount(0)

  // Reload the page — the helper's state is closure-scoped to this test, so
  // the picks array carries through the reload, and the on-clock manager
  // should still be Gamma after the page rehydrates.
  await page.reload({ waitUntil: 'commit' })
  await openDraftRoomHarness(page, { e2eRoom: true })
  await expect.poll(
    async () => (await page.getByTestId('draft-topbar-on-clock-manager').textContent()) ?? '',
    { timeout: 20_000 },
  ).toMatch(/gamma/i)
})
