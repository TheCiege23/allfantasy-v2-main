/**
 * Render-pipeline guard for the AI ADP overlay in the draft room.
 *
 * Background — bug history this protects against:
 *   1. The resolver and the recompute writer used different `playerKey` shapes,
 *      so 100% of AI ADP lookups silently missed in the live pool. Fixed by
 *      unifying on @/lib/adp/playerKey.
 *   2. Even after the resolver started returning aiAdp, the
 *      `normalizeDraftPlayer` pass was stripping aiAdp* fields out of the
 *      response because they weren't listed in the return literal. Fixed by
 *      adding them to RawDraftPlayerLike + the returned NormalizedDraftEntry.
 *
 * This spec mocks the draft pool API with a payload containing populated
 * `aiAdp` fields (mimicking what the real resolver now returns) and asserts
 * the value reaches the rendered table cell. It does NOT exercise the
 * resolver itself — that path is locked down by lib/adp/playerKey regression
 * tests + the all-sports Node resolver probes.
 *
 * Scope intentionally narrow per Shape A:
 *   - NFL covered as a passing assertion.
 *   - NBA covered as a SKIPPED assertion that documents a real product gap:
 *     non-NFL pools fall through to `PlayerListVirtualized` (card layout) in
 *     `components/app/draft-room/PlayerPanel.tsx:1316-1322`, and the card
 *     component (`DraftPlayerCard`) doesn't reference `aiAdp` at all. So
 *     the AI ADP overlay we just unblocked at the resolver layer never reaches
 *     the rendered NBA pool — even though the API returns `aiAdp` correctly.
 *     Unskipping this test requires wiring AI ADP into the card layout
 *     (or forcing `viewModeOverride='sleeper_table'` for non-NFL through the
 *     harness so `SleeperPoolTable` renders for those sports too).
 *   - Single page open, no pick / queue / chat / multi-tab.
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
      if ('caches' in window) {
        void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      }
      if ('serviceWorker' in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      }
    } catch {
      // best effort
    }
  })
})

test.afterEach(async ({ context }) => {
  await context.clearCookies().catch(() => null)
})

/**
 * Pool payload that mirrors what `getResolvedDraftPoolForLeague` returns after
 * the playerKey + normalizeDraftPlayer fixes — `aiAdp` populated for star
 * players, null for at least one entry to verify the table doesn't crash on
 * partial coverage. Each entry includes the `display` PlayerDisplayModel
 * shape because `buildUnifiedMeta` reads `entry.display.sport` and explodes
 * if the field is missing (the existing click-audit helper has the same bug
 * but its assertions are loose enough to tolerate it).
 */
function makeEntry(
  sport: string,
  args: {
    id: string
    name: string
    position: string
    team: string | null
    adp: number | null
    aiAdp: number | null
    aiAdpSampleSize?: number
    aiAdpLowSample?: boolean
  },
) {
  const teamAbbr = args.team
  return {
    playerId: args.id,
    name: args.name,
    position: args.position,
    team: teamAbbr,
    adp: args.adp,
    aiAdp: args.aiAdp,
    aiAdpSampleSize: args.aiAdpSampleSize ?? 0,
    aiAdpLowSample: args.aiAdpLowSample ?? false,
    display: {
      playerId: args.id,
      displayName: args.name,
      sport,
      assets: {
        headshotUrl: null,
        teamLogoUrl: null,
        headshotFallbackUsed: true,
        teamLogoFallbackUsed: true,
      },
      team: teamAbbr
        ? {
            teamId: teamAbbr,
            abbreviation: teamAbbr,
            displayName: teamAbbr,
            sport,
            logoUrl: null,
          }
        : null,
      stats: {
        adp: args.adp,
        byeWeek: null,
      },
      metadata: {
        position: args.position,
        teamAbbreviation: teamAbbr,
        teamAffiliation: teamAbbr,
        byeWeek: null,
        injuryStatus: null,
        sport,
      },
    },
  }
}

interface SportFixture {
  /** Sport key passed to the harness URL + the pool response payload. */
  sport: 'NFL' | 'NBA'
  /** Star player a Phase 5A test can assert is visible in the DOM. */
  starPlayerName: string
  /** Pool entries — at least one with a populated aiAdp + one without. */
  poolEntries: ReturnType<typeof makeEntry>[]
}

const SPORT_FIXTURES: SportFixture[] = [
  {
    sport: 'NFL',
    starPlayerName: 'Bijan Robinson',
    poolEntries: [
      makeEntry('NFL', { id: 'p-bijan', name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 36.72, aiAdp: 3, aiAdpSampleSize: 12 }),
      makeEntry('NFL', { id: 'p-mike-evans', name: 'Mike Evans', position: 'WR', team: 'TB', adp: 31.57, aiAdp: 3.5, aiAdpSampleSize: 8, aiAdpLowSample: true }),
      makeEntry('NFL', { id: 'p-tj-hockenson', name: 'T.J. Hockenson', position: 'TE', team: 'MIN', adp: 93.61, aiAdp: 78, aiAdpSampleSize: 5, aiAdpLowSample: true }),
      makeEntry('NFL', { id: 'p-no-adp', name: 'Depth Player', position: 'WR', team: null, adp: null, aiAdp: null }),
    ],
  },
  {
    sport: 'NBA',
    starPlayerName: 'Nikola Jokic',
    poolEntries: [
      makeEntry('NBA', { id: 'p-jokic', name: 'Nikola Jokic', position: 'C', team: 'DEN', adp: 1.2, aiAdp: 1, aiAdpSampleSize: 18 }),
      makeEntry('NBA', { id: 'p-luka', name: 'Luka Doncic', position: 'PG', team: 'DAL', adp: 2.4, aiAdp: 2, aiAdpSampleSize: 15 }),
      makeEntry('NBA', { id: 'p-tatum', name: 'Jayson Tatum', position: 'SF', team: 'BOS', adp: 5.1, aiAdp: 4.5, aiAdpSampleSize: 7, aiAdpLowSample: true }),
      makeEntry('NBA', { id: 'p-nba-no-adp', name: 'Bench Player', position: 'SG', team: null, adp: null, aiAdp: null }),
    ],
  },
]

for (const fixture of SPORT_FIXTURES) {
  // Non-NFL pools render through PlayerListVirtualized (card layout) which
  // doesn't currently reference aiAdp. Unskip once that pipeline lands.
  const testFn = fixture.sport === 'NFL' ? test : test.skip
  testFn(`draft room renders AI ADP column from pool API response (${fixture.sport})`, async ({ page }) => {
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(45_000)
    attachDraftHarnessDiagnostics(page)

    const leagueId = createLeagueId(`e2e-ai-adp-render-${fixture.sport.toLowerCase()}`)
    await mockDraftRoomApis(page, leagueId)

    // Override the default pool mock with our aiAdp-flavored payload AFTER
    // mockDraftRoomApis has set up its own. Last-registered Playwright route wins.
    await page.route('**/api/leagues/*/draft/pool**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: fixture.poolEntries,
          sport: fixture.sport,
          count: fixture.poolEntries.length,
        }),
      })
    })

    await gotoDraftRoomHarness(
      page,
      `/e2e/draft-room?leagueId=${leagueId}&sport=${fixture.sport}&e2eRoom=1`,
    )
    await openDraftRoomHarness(page, { e2eRoom: true })

    // Resolver short-circuit guard.
    await expect(page.getByText(/roster configuration incomplete/i)).toHaveCount(0)

    // At least one star from the mocked pool reaches the DOM.
    await expect(page.getByText(fixture.starPlayerName).first()).toBeVisible({ timeout: 30_000 })

    // The AI ADP column emits `data-testid` ending in "-ai-adp" per row. Each cell
    // shows the formatted aiAdp value when present (em-dash when null).
    const aiAdpCells = page.locator('[data-testid$="-ai-adp"]')
    await expect.poll(async () => aiAdpCells.count(), { timeout: 30_000 }).toBeGreaterThan(0)

    // At least one cell must show a numeric value, proving the field survived
    // API → client state → normalizeDraftPlayer → cell — for non-NFL too.
    const populated = aiAdpCells.filter({ hasText: /\d/ })
    await expect.poll(async () => populated.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })
}
