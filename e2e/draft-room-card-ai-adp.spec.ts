/**
 * Card-layout AI ADP render guard.
 *
 * The default DraftRoom layout for non-NFL sports is the card layout
 * (`PlayerListVirtualized` → `DraftPlayerCard`). Before this branch the card
 * never rendered AI ADP — the field was wired through the table component
 * (`SleeperPoolTable`) only, and PR #44 worked around the gap by clicking the
 * `draft-pool-view-table` toggle for non-NFL fixtures.
 *
 * This spec asserts the AI ADP overlay reaches the card layout for both
 * sports without any toggle click:
 *   - NFL: explicitly switch to card view (`draft-pool-view-cards`) so the
 *     existing default-table behavior isn't masking a regression.
 *   - NBA: take the default render path (card layout is automatic).
 *
 * Distinct testid from the table cell:
 *   table   → `[data-testid^="sleeper-pool-row-"][data-testid$="-ai-adp"]`
 *   card    → `[data-testid^="draft-player-card-"][data-testid$="-ai-adp"]`
 *
 * The card cell sets `data-low-sample="true"` when the helper supplied a
 * `aiAdpLowSample` flag — kept here so a future test can branch on
 * confidence styling without changing the shape.
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
})

test.afterEach(async ({ context }) => {
  await context.clearCookies().catch(() => null)
})

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
  return {
    playerId: args.id,
    name: args.name,
    position: args.position,
    team: args.team,
    adp: args.adp,
    aiAdp: args.aiAdp,
    aiAdpSampleSize: args.aiAdpSampleSize ?? 0,
    aiAdpLowSample: args.aiAdpLowSample ?? false,
    display: {
      playerId: args.id,
      displayName: args.name,
      sport,
      assets: { headshotUrl: null, teamLogoUrl: null, headshotFallbackUsed: true, teamLogoFallbackUsed: true },
      team: args.team
        ? { teamId: args.team, abbreviation: args.team, displayName: args.team, sport, logoUrl: null }
        : null,
      stats: { adp: args.adp, byeWeek: null },
      metadata: {
        position: args.position,
        teamAbbreviation: args.team,
        teamAffiliation: args.team,
        byeWeek: null,
        injuryStatus: null,
        sport,
      },
    },
  }
}

interface SportFixture {
  sport: 'NFL' | 'NBA'
  starPlayerName: string
  poolEntries: ReturnType<typeof makeEntry>[]
  /** true when the sport defaults to the card layout — we don't need to click. */
  cardIsDefault: boolean
}

const SPORT_FIXTURES: SportFixture[] = [
  {
    sport: 'NFL',
    starPlayerName: 'Bijan Robinson',
    cardIsDefault: false,
    poolEntries: [
      makeEntry('NFL', { id: 'p-bijan', name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 36.72, aiAdp: 3, aiAdpSampleSize: 12 }),
      makeEntry('NFL', { id: 'p-mike', name: 'Mike Evans', position: 'WR', team: 'TB', adp: 31.57, aiAdp: 3.5, aiAdpSampleSize: 8, aiAdpLowSample: true }),
      makeEntry('NFL', { id: 'p-no-adp', name: 'Depth Player', position: 'WR', team: null, adp: null, aiAdp: null }),
    ],
  },
  {
    sport: 'NBA',
    starPlayerName: 'Nikola Jokic',
    cardIsDefault: true,
    poolEntries: [
      makeEntry('NBA', { id: 'p-jokic', name: 'Nikola Jokic', position: 'C', team: 'DEN', adp: 1.2, aiAdp: 1, aiAdpSampleSize: 18 }),
      makeEntry('NBA', { id: 'p-luka', name: 'Luka Doncic', position: 'PG', team: 'DAL', adp: 2.4, aiAdp: 2, aiAdpSampleSize: 15 }),
      makeEntry('NBA', { id: 'p-no-adp', name: 'Bench Player', position: 'SG', team: null, adp: null, aiAdp: null }),
    ],
  },
]

for (const fixture of SPORT_FIXTURES) {
  test(`card layout shows AI ADP cell from pool API response (${fixture.sport})`, async ({ page }) => {
    page.setDefaultTimeout(15_000)
    page.setDefaultNavigationTimeout(45_000)
    attachDraftHarnessDiagnostics(page)

    const leagueId = createLeagueId(`e2e-card-ai-adp-${fixture.sport.toLowerCase()}`)
    await mockDraftRoomApis(page, leagueId)

    await page.route('**/api/leagues/*/draft/pool**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ entries: fixture.poolEntries, sport: fixture.sport, count: fixture.poolEntries.length }),
      })
    })

    await gotoDraftRoomHarness(
      page,
      `/e2e/draft-room?leagueId=${leagueId}&sport=${fixture.sport}&e2eRoom=1`,
    )
    await openDraftRoomHarness(page, { e2eRoom: true })

    await expect(page.getByText(/roster configuration incomplete/i)).toHaveCount(0)
    await expect(page.getByText(fixture.starPlayerName).first()).toBeVisible({ timeout: 30_000 })

    // NFL defaults to table view — click the card-view toggle so we exercise
    // the same DraftPlayerCard render path the non-NFL sports take by default.
    if (!fixture.cardIsDefault) {
      const cardViewToggle = page.getByTestId('draft-pool-view-cards')
      await expect(cardViewToggle).toBeVisible({ timeout: 15_000 })
      await cardViewToggle.click()
    }

    // Card cells emit a sport-agnostic `${testId}-ai-adp` testid where testId is
    // `draft-player-card-${rowIdx}`. The selector below matches every card row's
    // AI ADP cell without binding to a specific row index (virtualization can
    // shift indices on small viewports).
    const aiAdpCells = page.locator(
      '[data-testid^="draft-player-card-"][data-testid$="-ai-adp"]',
    )
    await expect.poll(async () => aiAdpCells.count(), { timeout: 30_000 }).toBeGreaterThan(0)

    // At least one cell must show a numeric value, proving the card-layout
    // pipeline (PlayerListVirtualized → DraftPlayerCard → AI ADP slot) carries
    // the field through end-to-end.
    const populated = aiAdpCells.filter({ hasText: /\d/ })
    await expect.poll(async () => populated.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })
}
