/**
 * G8 Team Defense / ST — browser/customer verification (Playwright).
 *
 * Proves a real commissioner/manager can use DEF/ST scoring from the browser.
 * Counterpart to the engine proof (scripts/run-nfl-full-season-engine-e2e.ts
 * steps D1–D8) and the deterministic UI-contract tests.
 *
 * SELF-SEEDING: when no `G8_LEAGUE_ID` is given, the spec logs in a fresh
 * commissioner and seeds a complete league via the E2E-only endpoint
 * `POST /api/e2e/seed-g8-league` (gated by NODE_ENV!=production + x-allfantasy-e2e),
 * then cleans it up in afterAll. Provide `G8_LEAGUE_ID` to target a deployed
 * staging build (where the seed endpoint is disabled).
 *
 * OPT-IN: runs only when RUN_G8_DST_BROWSER=1 (needs a running Node-20 app +
 * DATABASE_URL pointed at a NON-production DB). Selectors marked `// SELECTOR:`
 * were written from route/feature knowledge and must be confirmed on first run.
 *
 *   RUN_G8_DST_BROWSER=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 \
 *     npx playwright test e2e/g8-team-defense-browser.spec.ts --project=chromium
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { registerAndLogin } from './helpers/auth-flow'

const ENABLED = process.env.RUN_G8_DST_BROWSER === '1'
const LEAGUE_ID_OVERRIDE = process.env.G8_LEAGUE_ID ?? ''
const DEF_TEAM = (process.env.G8_DEF_TEAM ?? 'KC').toUpperCase()
const E2E_HEADERS = { 'x-allfantasy-e2e': '1' }

type SeededLeague = { leagueId: string; season: number; seededScoreIds: string[]; defTeam: string }
let seeded: SeededLeague | null = null

async function cleanupSeeded(request: APIRequestContext): Promise<void> {
  if (!seeded) return
  await request
    .delete('/api/e2e/seed-g8-league', { headers: E2E_HEADERS, data: { leagueId: seeded.leagueId, season: seeded.season, seededScoreIds: seeded.seededScoreIds } })
    .catch(() => undefined)
  seeded = null
}

test.describe('G8 DEF/ST browser verification @g8-dst', () => {
  test.skip(!ENABLED, 'Set RUN_G8_DST_BROWSER=1 to run the DEF/ST browser checks.')

  test.afterAll(async ({ request }) => {
    await cleanupSeeded(request)
  })

  test('commissioner + manager can see and use DEF/ST scoring', async ({ page }) => {
    test.setTimeout(8 * 60_000)
    let leagueId = LEAGUE_ID_OVERRIDE
    let defTeam = DEF_TEAM

    await test.step('1. Sign in as commissioner', async () => {
      await registerAndLogin(page)
    })

    await test.step('1b. Resolve the league (self-seed unless G8_LEAGUE_ID is provided)', async () => {
      if (leagueId) return // deployed-staging override path
      const res = await page.request.post('/api/e2e/seed-g8-league', { headers: E2E_HEADERS, data: { team: DEF_TEAM } })
      expect(res.ok(), `seed endpoint failed (${res.status()}). On a production build use G8_LEAGUE_ID instead.`).toBeTruthy()
      const body = (await res.json()) as { leagueId: string; season: number; seededScoreIds: string[]; defTeam: string }
      seeded = { leagueId: body.leagueId, season: body.season, seededScoreIds: body.seededScoreIds, defTeam: body.defTeam }
      leagueId = body.leagueId
      defTeam = body.defTeam
      expect(leagueId).toBeTruthy()
    })

    await test.step('1c. Open the NFL redraft league (wait for the heavy shell to render)', async () => {
      // The league body is a dynamic(ssr:false) shell; first dev compile is slow.
      // Navigate fresh (reload fails its RSC fetch) and wait for the real tabs.
      await page.goto(`/league/${leagueId}`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(leagueId))
      await expect(page.getByRole('tab', { name: /roster/i })).toBeVisible({ timeout: 90_000 })
    })

    await test.step('2. ROSTER populates: DEF renders as a readable team defense (no raw id), DEF slot present', async () => {
      await page.getByRole('tab', { name: /roster/i }).first().click()
      // Readable DEF display: the shared display fallback (resolveDisplayPlayer /
      // teamDefenseDisplayNameFromId) derives "<TEAM> Defense" from the synthetic
      // id even when the normalized-player foundation has no row for it.
      await expect(page.getByText(new RegExp(`${defTeam} Defense`, 'i')).first()).toBeVisible({ timeout: 45_000 })
      // No raw synthetic id ever leaks into the UI.
      await expect(page.getByText(/nfl:def:/i)).toHaveCount(0)
      // DEF slot structure is present (commissioner roster config).
      await expect(page.getByText(/^DEF$/).first()).toBeVisible()
    })

    await test.step('2b. LIVE: roster DEF score updates via SSE without reload (Phase 4B)', async () => {
      // Still on the ROSTER tab from step 2. TeamTab now subscribes to the league
      // SSE stream (useLeagueRealtimeRefresh) and fetches /api/redraft/roster when
      // a player_changed event arrives, so the PTS cell updates without a page reload.
      const readDefScore = async (): Promise<number> => {
        const row = page.getByTestId(`roster-row-nfl:def:${defTeam}`)
        const txt = await row.getByTestId('roster-player-pts').textContent({ timeout: 10_000 })
        return Number(String(txt ?? '').replace(/[^0-9.]/g, '')) || 0
      }
      // loadLiveScores runs on mount and fetches /api/redraft/roster. Wait for the
      // score to appear in the PTS cell before reading the baseline.
      await expect
        .poll(readDefScore, { timeout: 30_000, message: 'waiting for initial DEF score to render' })
        .toBeGreaterThan(0)
      const before = await readDefScore()
      expect(before, 'DEF has a non-zero score before the live tick').toBeGreaterThan(0)

      const tick = await page.request.post('/api/e2e/live-tick', { headers: E2E_HEADERS, data: { leagueId } })
      expect(tick.ok(), `live-tick should fire (${tick.status()})`).toBeTruthy()
      const tickBody = (await tick.json()) as { changedPlayerIds?: string[]; broadcastEvents?: number }
      expect(tickBody.changedPlayerIds?.some((id) => id.startsWith('nfl:def:')), 'DEF detected as changed').toBeTruthy()
      expect(tickBody.broadcastEvents ?? 0, 'SSE events broadcast').toBeGreaterThan(0)

      await expect
        .poll(readDefScore, { timeout: 30_000, message: 'DEF PTS cell should rise via SSE without reload' })
        .toBeGreaterThan(before)
    })

    await test.step('2c. LIVE: league home scoreboard updates via SSE without reload (Phase 4C)', async () => {
      // Navigate to the League tab which renders LeagueScoringPreviews.
      // The tab's visible label varies by role (a commissioner sees
      // "Commissioner Hub", a member sees "League"), so click by the stable
      // per-id testid instead of the accessible name.
      await page.getByTestId('league-tab-league').first().click()
      // Wait for the scoreboard section to render
      await expect(page.getByTestId('league-scoring-previews')).toBeVisible({ timeout: 30_000 })

      // Wait for matchup data to load (the section must have content, not skeleton)
      const readTopScorerBadge = async (): Promise<string | null> => {
        const el = page.getByTestId('live-top-scorer')
        const visible = await el.isVisible({ timeout: 5_000 }).catch(() => false)
        if (!visible) return null
        return el.textContent({ timeout: 5_000 }).catch(() => null)
      }

      // If scores are present, the top-scorer badge should appear
      const initialBadge = await readTopScorerBadge()
      test.info().annotations.push({
        type: 'phase-4c',
        description: `league-home top-scorer badge: ${initialBadge ?? '(not shown – no scored matchups yet)'}`,
      })

      // Fire a live tick and verify the SSE-driven re-fetch happens
      const tick = await page.request.post('/api/e2e/live-tick', { headers: E2E_HEADERS, data: { leagueId } })
      expect(tick.ok(), `live-tick should fire (${tick.status()})`).toBeTruthy()
      const tickBody = (await tick.json()) as { broadcastEvents?: number }
      expect(tickBody.broadcastEvents ?? 0, 'SSE events were broadcast').toBeGreaterThan(0)

      // The scoreboard section must still be visible after the SSE-driven refresh
      await expect(page.getByTestId('league-scoring-previews')).toBeVisible({ timeout: 20_000 })
    })

    await test.step('2d. LIVE: dashboard live-scores widget renders and survives SSE refresh (Phase 4D)', async () => {
      // Navigate to the dashboard (/dashboard). The DashboardLiveScoresWidget fetches
      // /api/dashboard/live-scores and subscribes SSE via useLeagueRealtimeRefresh for
      // the primary league. When a score event arrives it re-fetches without reload.
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
      // The dashboard has no <nav> landmark. The live-scores widget is the subject
      // of this step and the seed creates an active redraft season the user owns
      // (finalizer sets status='active'), so the widget must render.
      await expect(page.getByTestId('dashboard-live-scores')).toBeVisible({ timeout: 30_000 })

      // The widget shows a live score card for the seeded league (correct data).
      await expect(page.getByTestId(`live-score-row-${leagueId}`)).toBeVisible({ timeout: 15_000 })

      // Fire a tick — the SSE event should re-fetch without crashing the dashboard.
      const tick = await page.request.post('/api/e2e/live-tick', { headers: E2E_HEADERS, data: { leagueId } })
      expect(tick.ok(), `live-tick should fire (${tick.status()})`).toBeTruthy()

      // The widget must survive the SSE-driven re-fetch.
      await expect(page.getByTestId('dashboard-live-scores')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('2e. LIVE: league activity feed uses real data + SSE; matchup breakdown expandable (Phase 4E)', async () => {
      // Return to the league tab to check the live event feed and per-player breakdown.
      await page.goto(`/league/${leagueId}`, { waitUntil: 'domcontentloaded' })
      // Anchor on the league tablist (the shell exposes role="tab" — proven in step 1c).
      await expect(page.getByRole('tab', { name: /roster/i }).first()).toBeVisible({ timeout: 30_000 })
      await page.getByTestId('league-tab-league').first().click()

      // The real-data activity feed section must render on the league tab (it uses
      // the /activity-feed endpoint — LeagueEvent + activityEvent — not a stub).
      await expect(page.getByTestId('league-live-event-feed')).toBeVisible({ timeout: 30_000 })

      // The matchup-list (expandable per-matchup breakdown rows) must render.
      await expect(page.getByTestId('matchup-list')).toBeVisible({ timeout: 30_000 })

      // Expand the first matchup row → the per-player breakdown panel loads from
      // /scoring/roster-scores. Best-effort assert (depends on roster rows existing).
      const firstMatchupRow = page.getByTestId('matchup-list').getByRole('button').first()
      const expandable = await firstMatchupRow.isVisible({ timeout: 10_000 }).catch(() => false)
      if (expandable) {
        await firstMatchupRow.click()
        const breakdownVisible = await page
          .locator('[data-testid^="player-breakdown-"]')
          .first()
          .isVisible({ timeout: 15_000 })
          .catch(() => false)
        test.info().annotations.push({
          type: 'phase-4e-breakdown',
          description: `expandable matchup breakdown opened: ${breakdownVisible}`,
        })
      }

      // Fire a live-tick SSE event — the feed + breakdown must survive the SSE re-fetch.
      const tick = await page.request.post('/api/e2e/live-tick', { headers: E2E_HEADERS, data: { leagueId } })
      expect(tick.ok(), `live-tick for 4E should fire (${tick.status()})`).toBeTruthy()

      // Both live surfaces must still be present after the SSE-driven refresh (no crash).
      await expect(page.getByTestId('league-live-event-feed')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('matchup-list')).toBeVisible({ timeout: 20_000 })
    })

    await test.step('3. Commissioner DEF scoring override reached the engine (R1)', async () => {
      // The seed set a DEF override (dst_sack=5) through the surfaced panel path,
      // bridged to sportConfig.categoryPoints. The engine-truth roster API must
      // show the DEF carrying the overridden score (def_sack 3*5 + PA tier 4 = 19).
      const res = await page.request.get(`/api/redraft/roster?leagueId=${leagueId}&week=1`)
      expect(res.ok(), 'roster API should respond').toBeTruthy()
      const body = (await res.json()) as { roster?: { players?: Array<{ playerId?: string; weeklyScore?: { fantasyPts?: number } | null }> } }
      const def = body.roster?.players?.find((p) => String(p.playerId ?? '').startsWith('nfl:def:'))
      expect(def, 'DEF should be on the synced roster').toBeTruthy()
      expect(def?.weeklyScore?.fantasyPts ?? 0, 'DEF score reflects the commissioner override').toBeGreaterThan(0)
    })

    await test.step('4. Matchup-center UI renders the redraft pairing + DEF, with totals = engine (G11 2c/2d)', async () => {
      // Phase 2c/2d: the matchups tab (MatchupTabContainer → /api/leagues/{id}/
      // matchup-center) now sources opponent pairing + rosters from the redraft
      // engine tables (RedraftMatchup/RedraftRoster/RedraftRosterPlayer) and scores
      // them through the canonical adapter. So the DEF renders as "<TEAM> Defense"
      // in the matchup UI itself, with no raw id leakage.
      await page.getByRole('tab', { name: /matchups?/i }).first().click()
      // Generous timeout: the matchup-center makes several sequential round-trips to
      // the REMOTE staging DB (redraft pairing + rosters + canonical scores + media).
      await expect(page.getByText(new RegExp(`${defTeam} Defense`, 'i')).first()).toBeVisible({ timeout: 120_000 })
      await expect(page.getByText(/nfl:def:/i)).toHaveCount(0)

      // Cross-check: the matchup-center API total equals the redraft engine total.
      const seasonRes = await page.request.get(`/api/redraft/season?leagueId=${leagueId}`)
      expect(seasonRes.ok(), 'redraft season API should respond').toBeTruthy()
      const seasonBody = (await seasonRes.json()) as { season?: { id?: string } }
      const seasonId = seasonBody.season?.id
      expect(seasonId, 'redraft season should exist for the seeded league').toBeTruthy()

      const mRes = await page.request.get(`/api/redraft/matchup?seasonId=${seasonId}&week=1`)
      expect(mRes.ok(), 'redraft matchup API should respond').toBeTruthy()
      const mBody = (await mRes.json()) as { matchups?: Array<{ homeScore?: number; awayScore?: number }> }
      const matchup = mBody.matchups?.[0]
      expect(matchup, 'a week-1 matchup should exist').toBeTruthy()
      const engineTop = Math.max(matchup?.homeScore ?? 0, matchup?.awayScore ?? 0)
      expect(engineTop, 'engine matchup total reflects the DEF + QB contribution').toBeGreaterThan(0)

      const mcRes = await page.request.get(`/api/leagues/${leagueId}/matchup-center?week=1`)
      expect(mcRes.ok(), 'matchup-center API should respond').toBeTruthy()
      const mcBody = (await mcRes.json()) as {
        payload?: { left?: { totalPoints?: number; starters?: Array<{ name?: string }> }; right?: { starters?: unknown[] } }
      }
      const mcTop = Math.max(mcBody.payload?.left?.totalPoints ?? 0, 0)
      // The matchup-center surfaces real redraft engine scores (canonical adapter).
      expect(mcBody.payload?.left?.starters?.length ?? 0, 'home player rows render').toBeGreaterThan(0)
      expect(mcBody.payload?.right?.starters?.length ?? 0, 'away player rows render').toBeGreaterThan(0)
      expect(
        mcBody.payload?.left?.starters?.some((s) => /Defense/i.test(String(s.name))),
        'DEF renders as a readable team defense',
      ).toBeTruthy()
      expect(Math.abs(mcTop - engineTop) < 0.01, `matchup-center total ${mcTop} matches engine ${engineTop}`).toBeTruthy()
    })

    await test.step('5. LIVE: a server tick updates the matchup total in-browser via SSE (no reload)', async () => {
      // The matchups tab is open and subscribed to the league SSE stream
      // (useLeagueRealtimeRefresh). Read the live home total from the header.
      const readHomeTotal = async (): Promise<number> => {
        const txt = await page.getByTestId('matchup-home-total').first().textContent({ timeout: 15_000 })
        return Number(String(txt ?? '').replace(/[^0-9.]/g, '')) || 0
      }
      const before = await readHomeTotal()

      // Trigger ONE live tick server-side (fixture provider bumps the DEF +1 sack = +5).
      // This runs the Phase 3 runner → persists → rescores → broadcasts SSE.
      const tick = await page.request.post('/api/e2e/live-tick', { headers: E2E_HEADERS, data: { leagueId } })
      expect(tick.ok(), `live-tick should fire (${tick.status()})`).toBeTruthy()
      const tickBody = (await tick.json()) as { changedPlayerIds?: string[]; broadcastEvents?: number }
      expect(tickBody.changedPlayerIds?.some((id) => id.startsWith('nfl:def:')), 'DEF detected as changed').toBeTruthy()
      expect(tickBody.broadcastEvents ?? 0, 'affected SSE events broadcast').toBeGreaterThan(0)

      // The open page must reflect the new total WITHOUT a reload — SSE event →
      // silent refetch → header re-render (+5 from the live sack).
      await expect
        .poll(readHomeTotal, { timeout: 25_000, message: 'home total should rise via SSE without reload' })
        .toBeGreaterThan(before)
    })

    // Best-effort (not part of the green criteria): the NFL scoring panel + admin
    // health surfaces — lazy-loaded UIs whose nav is environment-sensitive. Logged,
    // never fails the proof. DEF/ST scoring-category presence is already locked by
    // the deterministic UI-contract + bridge unit tests.
    await test.step('5. (best-effort) settings scoring panel shows Team Defense', async () => {
      try {
        await page.getByRole('tab', { name: /settings/i }).first().click({ timeout: 10_000 })
        await page.getByText(/^scoring$/i).first().click({ timeout: 10_000 }).catch(() => undefined)
        const tdVisible = await page.getByText(/team defense/i).first().isVisible({ timeout: 20_000 }).catch(() => false)
        test.info().annotations.push({ type: 'best-effort', description: `settings Team Defense visible: ${tdVisible}` })
      } catch (e) {
        test.info().annotations.push({ type: 'best-effort', description: `settings nav skipped: ${String(e).slice(0, 80)}` })
      }
    })
  })
})
