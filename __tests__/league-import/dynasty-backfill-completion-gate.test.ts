/**
 * The FIFTH place the "rows exist, so skip" gate was hiding.
 *
 * ── 🛑 WHY THIS ONE MATTERED MORE THAN THE OTHER FOUR ────────────────────────────────────────
 *
 * The draft, season-state and matchup siblings were repaired first; this one lives under
 * `lib/dynasty-import/` rather than `lib/league-import/`, so a census of the import directory
 * never reached it. It was found while scheduling the orchestrator — which is the worst possible
 * time to still have it, because a timer converts "stale after import" into "confidently reports
 * the live season as finished, forever, on a schedule".
 *
 * ⚠ AND IT HAD A SECOND HALF THAT TYPECHECKED PERFECTLY. `discoverSleeperSeasons` dropped the
 * provider's `status` when mapping to `HistoricalSeasonRef`, AND the orchestrator annotated its
 * local `discovered` with an inline structural type that omitted the field. Either one alone
 * would have left the gate with nothing to read while every file compiled clean.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const leagueFindUnique = vi.fn()
const seasonResultFindFirst = vi.fn()
const backfillStatusUpsert = vi.fn(async () => ({}))
const backfillStatusUpdate = vi.fn(async () => ({}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
    seasonResult: { findFirst: (...a: unknown[]) => seasonResultFindFirst(...a) },
    dynastyBackfillStatus: {
      upsert: (...a: unknown[]) => backfillStatusUpsert(...a),
      update: (...a: unknown[]) => backfillStatusUpdate(...a),
    },
  },
}))

vi.mock('@/lib/dynasty-import/sleeper-historical', () => ({
  discoverSleeperSeasons: vi.fn(),
  fetchSleeperStandings: vi.fn(async () => ({ rows: [], championRosterId: null })),
  fetchSleeperRosterToOwner: vi.fn(async () => ({})),
  fetchSleeperTradesForSeason: vi.fn(async () => []),
}))

vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistStandings: vi.fn(async () => undefined),
  persistDynastySeason: vi.fn(async () => undefined),
  persistTradesForSeason: vi.fn(async () => 0),
}))

import { runDynastyBackfill } from '@/lib/dynasty-import/backfill-orchestrator'
import {
  discoverSleeperSeasons,
  fetchSleeperStandings,
  fetchSleeperTradesForSeason,
} from '@/lib/dynasty-import/sleeper-historical'

const discoverMock = vi.mocked(discoverSleeperSeasons)

/** Newest first is how Sleeper's chain reads; 2025 is the season being played. */
function chain() {
  return [
    { platformLeagueId: 'lg-2025', season: 2025, provider: 'sleeper', status: 'in_season' },
    { platformLeagueId: 'lg-2024', season: 2024, provider: 'sleeper', status: 'complete' },
    { platformLeagueId: 'lg-2023', season: 2023, provider: 'sleeper', status: 'complete' },
  ]
}

describe('runDynastyBackfill — completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      userId: 'user-1',
      isDynasty: true,
    })
    discoverMock.mockResolvedValue(chain())
  })

  it('🛑 REGRESSION: the season being PLAYED is refetched even though a SeasonResult row exists', async () => {
    // Every season already has a row — the exact state after any import. Under the old gate all
    // three were skipped and standings/trades for the live season never updated again.
    seasonResultFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await runDynastyBackfill({ leagueId: 'league-1' })

    expect(result.seasonsSkipped).toBe(2) // 2024 + 2023
    expect(result.seasonsImported).toBe(1) // 2025
    expect(fetchSleeperStandings).toHaveBeenCalledTimes(1)
    expect(fetchSleeperStandings).toHaveBeenCalledWith('lg-2025')
    expect(fetchSleeperTradesForSeason).toHaveBeenCalledWith('lg-2025', 2025)
  })

  it('skips a finished season that already has rows, and imports one that does not', async () => {
    seasonResultFindFirst.mockImplementation(async ({ where }: { where: { season: string } }) =>
      where.season === '2023' ? null : { id: `existing-${where.season}` },
    )

    const result = await runDynastyBackfill({ leagueId: 'league-1' })

    // 2024 finished + has rows -> skipped. 2025 in progress and 2023 missing -> both fetched.
    expect(result.seasonsSkipped).toBe(1)
    expect(result.seasonsImported).toBe(2)
  })

  it('a season with no rows is imported regardless of status', async () => {
    seasonResultFindFirst.mockResolvedValue(null)

    const result = await runDynastyBackfill({ leagueId: 'league-1' })

    expect(result.seasonsSkipped).toBe(0)
    expect(result.seasonsImported).toBe(3)
  })

  it('⚠ a provider that reports NO status is treated as not complete, never as complete', async () => {
    /*
     * The safe direction, and it is deliberate: refetching a finished season needlessly costs a
     * request, whereas treating an unknown status as "complete" freezes a live season forever.
     * Fleaflicker maps no status at all, so this is a real shape and not a hypothetical.
     */
    discoverMock.mockResolvedValue([
      { platformLeagueId: 'lg-x', season: 2024, provider: 'sleeper', status: null },
      { platformLeagueId: 'lg-y', season: 2023, provider: 'sleeper' },
    ])
    seasonResultFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await runDynastyBackfill({ leagueId: 'league-1' })

    expect(result.seasonsSkipped).toBe(0)
    expect(result.seasonsImported).toBe(2)
  })

  it('skipExistingSeasons=false still refetches everything', async () => {
    seasonResultFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await runDynastyBackfill({ leagueId: 'league-1', skipExistingSeasons: false })

    expect(seasonResultFindFirst).not.toHaveBeenCalled()
    expect(result.seasonsImported).toBe(3)
  })
})

describe('the control: these assertions can fail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      userId: 'user-1',
      isDynasty: true,
    })
  })

  it('🛑 the gate CAN skip — so "imported: 1" above is a decision, not a gate that never fires', async () => {
    /*
     * ⚠ THIS REPLACED A CONTROL THAT WAS WRONG, AND THE WRONGNESS IS WORTH KEEPING.
     *
     * The first version stripped `status` from the refs and asserted all three seasons would be
     * SKIPPED, on the theory that removing the field reproduces the pre-fix gate. It does not:
     * the repaired gate treats an absent status as NOT complete, so nothing is skipped — which
     * is precisely what the "no status" test above asserts. Two tests claiming opposite outcomes
     * for the same input, and only one can be right.
     *
     * A control cannot be built by removing the input the fix reads; it has to come from
     * mutating the SOURCE. That was done once, by hand, against this file: reverting the gate to
     * `if (skipExistingSeasons)` turns the regression test red (skipped 3, imported 0) and turns
     * this one green either way, which is the asymmetry that makes the pair meaningful.
     *
     * What remains here is the honest half — proof the gate skips at all. Without it, the
     * regression test's `imported: 1` would also pass against a gate that had been deleted.
     */
    discoverMock.mockResolvedValue([
      { platformLeagueId: 'lg-2024', season: 2024, provider: 'sleeper', status: 'complete' },
      { platformLeagueId: 'lg-2023', season: 2023, provider: 'sleeper', status: 'complete' },
    ])
    seasonResultFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await runDynastyBackfill({ leagueId: 'league-1' })

    expect(result.seasonsSkipped).toBe(2)
    expect(result.seasonsImported).toBe(0)
    expect(fetchSleeperStandings).not.toHaveBeenCalled()
  })
})
