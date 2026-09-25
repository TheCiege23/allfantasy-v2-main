/**
 * "What's on file" for an imported league — the Overview's coverage panel.
 *
 * 🛑 THE TRAP THIS FILE EXISTS FOR IS THE ID SPACE. `WeeklyMatchup` and
 * `LeaguePlayerWeeklyScore` key on the PROVIDER league id; every `dw_*` fact table and
 * both season tables key on `League.id`. A table queried with the wrong one returns zero
 * rows and no error — which this panel would print, confidently, as "None".
 *
 * ⚠ AND "NOTHING ON FILE" HAS FIVE MEANINGS. Each test below pins one of them against the
 * others, because the panel's whole value is saying WHICH.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const standingGroupBy = vi.fn()
const weeklyGroupBy = vi.fn()
const draftGroupBy = vi.fn()
const txGroupBy = vi.fn()
const lineupGroupBy = vi.fn()
const seasonFindMany = vi.fn()
const dynastyFindMany = vi.fn()
const matchupGroupBy = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    seasonStandingFact: { groupBy: (...a: unknown[]) => standingGroupBy(...a) },
    weeklyMatchup: { groupBy: (...a: unknown[]) => weeklyGroupBy(...a) },
    draftFact: { groupBy: (...a: unknown[]) => draftGroupBy(...a) },
    transactionFact: { groupBy: (...a: unknown[]) => txGroupBy(...a) },
    leaguePlayerWeeklyScore: { groupBy: (...a: unknown[]) => lineupGroupBy(...a) },
    leagueSeason: { findMany: (...a: unknown[]) => seasonFindMany(...a) },
    leagueDynastySeason: { findMany: (...a: unknown[]) => dynastyFindMany(...a) },
    matchupFact: { groupBy: (...a: unknown[]) => matchupGroupBy(...a) },
  },
}))

import {
  buildLeagueDataCoverage,
  describeSeasons,
  getLeagueDataCoverage,
  type LeagueDataCoverage,
  type LeagueDataCoverageInput,
  type LeagueDataCoverageRecord,
} from '@/lib/core-app/leagueDataCoverage'

const LEAGUE_ID = 'af-uuid-1'
const PROVIDER_ID = '1338541390891606016'

const SLEEPER: LeagueDataCoverageRecord = {
  id: LEAGUE_ID,
  platform: 'sleeper',
  platformLeagueId: PROVIDER_ID,
  settings: {},
  syncStatus: 'success',
  lastSyncedAt: new Date('2026-09-15T12:00:00Z'),
}

const count = (season: number | null, n = 1) => ({ season, _count: { _all: n } })

/** Every read empty and successful — the baseline each test changes one thing on. */
function emptyReads() {
  standingGroupBy.mockResolvedValue([])
  weeklyGroupBy.mockResolvedValue([])
  draftGroupBy.mockResolvedValue([])
  txGroupBy.mockResolvedValue([])
  lineupGroupBy.mockResolvedValue([])
  seasonFindMany.mockResolvedValue([])
  dynastyFindMany.mockResolvedValue([])
  matchupGroupBy.mockResolvedValue([])
}

/** `transactionFact.groupBy` serves trades and non-trades; tell them apart by the filter. */
function transactions({ trades, other }: { trades: unknown; other: unknown }) {
  txGroupBy.mockImplementation((args: { where: { type: unknown } }) => {
    const value = args.where.type === 'trade' ? trades : other
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  })
}

const row = (coverage: LeagueDataCoverage | null, key: string) => {
  const found = coverage?.rows.find((r) => r.key === key)
  if (!found) throw new Error(`no ${key} row`)
  return found
}

beforeEach(() => {
  for (const fn of [
    standingGroupBy,
    weeklyGroupBy,
    draftGroupBy,
    txGroupBy,
    lineupGroupBy,
    seasonFindMany,
    dynastyFindMany,
    matchupGroupBy,
  ]) {
    fn.mockReset()
  }
  emptyReads()
})

describe('getLeagueDataCoverage — which id each table is asked with', () => {
  it('asks the provider-keyed tables with the provider id, and everything else with League.id', async () => {
    await getLeagueDataCoverage(SLEEPER)

    const whereOf = (fn: ReturnType<typeof vi.fn>) =>
      fn.mock.calls.map((c) => (c[0] as { where: { leagueId: string } }).where.leagueId)

    expect(whereOf(weeklyGroupBy)).toEqual([PROVIDER_ID])
    expect(whereOf(lineupGroupBy)).toEqual([PROVIDER_ID])

    expect(whereOf(standingGroupBy)).toEqual([LEAGUE_ID])
    expect(whereOf(draftGroupBy)).toEqual([LEAGUE_ID])
    expect(whereOf(txGroupBy)).toEqual([LEAGUE_ID, LEAGUE_ID])
    expect(whereOf(seasonFindMany)).toEqual([LEAGUE_ID])
    expect(whereOf(dynastyFindMany)).toEqual([LEAGUE_ID])
    expect(whereOf(matchupGroupBy)).toEqual([LEAGUE_ID])
  })

  it('counts only STARTING lineups', async () => {
    await getLeagueDataCoverage(SLEEPER)
    expect(lineupGroupBy.mock.calls[0]![0]).toMatchObject({ where: { isStarter: true } })
  })

  it('issues no query at all for a native league, and returns nothing to show', async () => {
    const coverage = await getLeagueDataCoverage({ ...SLEEPER, platform: 'manual' })

    expect(coverage).toBeNull()
    for (const fn of [standingGroupBy, weeklyGroupBy, draftGroupBy, txGroupBy, lineupGroupBy, seasonFindMany]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('skips the provider-keyed tables when the league has no provider id, rather than asking with null', async () => {
    const coverage = await getLeagueDataCoverage({ ...SLEEPER, platformLeagueId: null })

    expect(weeklyGroupBy).not.toHaveBeenCalled()
    expect(lineupGroupBy).not.toHaveBeenCalled()
    expect(row(coverage, 'lineups').status).toBe('none')
  })
})

describe('getLeagueDataCoverage — what it reports', () => {
  it('lists the seasons a fully imported Sleeper league holds, per kind', async () => {
    weeklyGroupBy.mockResolvedValue([{ seasonYear: 2024 }, { seasonYear: 2025 }])
    draftGroupBy.mockResolvedValue([count(2022, 180), count(2023, 180), count(2024, 180), count(2025, 180)])
    transactions({ trades: [count(2024, 14), count(2025, 9)], other: [count(2025, 310)] })
    lineupGroupBy.mockResolvedValue([
      { seasonYear: 2025, week: 1 },
      { seasonYear: 2025, week: 2 },
      { seasonYear: 2025, week: 3 },
    ])
    dynastyFindMany.mockResolvedValue([{ season: 2021 }, { season: 2022 }])

    const coverage = await getLeagueDataCoverage(SLEEPER)

    expect(coverage?.platformLabel).toBe('Sleeper')
    expect(coverage?.rows.map((r) => [r.key, r.status])).toEqual([
      ['seasons', 'available'],
      ['standings', 'available'],
      ['drafts', 'available'],
      ['trades', 'available'],
      ['transactions', 'available'],
      ['lineups', 'available'],
    ])
    expect(row(coverage, 'seasons').detail).toBe('Seasons 2021–2025')
    expect(row(coverage, 'drafts').detail).toBe('Seasons 2022–2025')
    expect(row(coverage, 'trades').seasons).toEqual([2024, 2025])
    expect(row(coverage, 'transactions').detail).toBe('Season 2025')
    expect(row(coverage, 'lineups').detail).toBe('Season 2025 · 3 weeks')
  })

  /**
   * ⚠ THE ESPN BACKFILL WRITES 0-0 STANDINGS FOR A SEASON THAT HAS NOT KICKED OFF, and the
   * Standings tab filters them (`loadSeasonHistory`). Without the same filter here this panel
   * would promise a standings season that the tab then refuses to show.
   */
  it('does not count an unplayed season of all-zero standings as standings', async () => {
    standingGroupBy.mockResolvedValue([
      { season: 2025, _sum: { wins: 40, losses: 40, ties: 0, pointsFor: 9000 } },
      { season: 2026, _sum: { wins: 0, losses: 0, ties: 0, pointsFor: 0 } },
    ])

    const coverage = await getLeagueDataCoverage({ ...SLEEPER, platform: 'espn' })

    expect(row(coverage, 'standings').seasons).toEqual([2025])
  })

  it('counts undated rows as data, and says the season is missing', async () => {
    transactions({ trades: [count(null, 6)], other: [] })

    const coverage = await getLeagueDataCoverage(SLEEPER)

    expect(row(coverage, 'trades').status).toBe('available')
    expect(row(coverage, 'trades').detail).toBe('On file, season not recorded')
  })

  it('marks only the failed read unknown, and keeps the seasons it did read', async () => {
    draftGroupBy.mockResolvedValue([count(2025, 180)])
    transactions({ trades: new Error('pool timeout'), other: [] })

    const coverage = await getLeagueDataCoverage(SLEEPER)

    expect(row(coverage, 'trades').status).toBe('unknown')
    expect(row(coverage, 'drafts').status).toBe('available')
    expect(row(coverage, 'transactions').status).toBe('none')
    expect(row(coverage, 'seasons').seasons).toEqual([2025])
  })
})

describe('buildLeagueDataCoverage — why a row is empty', () => {
  const base: LeagueDataCoverageInput = {
    platform: 'espn',
    syncStatus: 'success',
    lastSyncedAt: new Date('2026-09-15T12:00:00Z'),
    providerCoverage: null,
    standings: { seasons: [], undated: 0 },
    drafts: { seasons: [], undated: 0 },
    trades: { seasons: [], undated: 0 },
    transactions: { seasons: [], undated: 0 },
    lineups: { weeksBySeason: new Map() },
    otherSeasons: { seasons: [], undated: 0 },
  }

  it('says "none" when we looked and found nothing', () => {
    expect(row(buildLeagueDataCoverage(base), 'drafts')).toMatchObject({
      status: 'none',
      detail: 'No draft results on file.',
    })
  })

  /**
   * ⚠ OUR GAP, NOT THE PLATFORM'S. Only the Sleeper ingester writes weekly lineups; an ESPN
   * league without them must not be told ESPN does not publish lineups.
   */
  it('says lineups are not imported yet for a platform no writer covers', () => {
    expect(row(buildLeagueDataCoverage(base), 'lineups')).toMatchObject({
      status: 'unsupported',
      detail: 'AllFantasy doesn’t import weekly lineups from ESPN yet.',
    })
    expect(row(buildLeagueDataCoverage({ ...base, platform: 'sleeper' }), 'lineups').status).toBe('none')
  })

  it('names the platform when its own coverage says it does not publish the thing', () => {
    const coverage = buildLeagueDataCoverage({
      ...base,
      platform: 'fleaflicker',
      providerCoverage: { tradeHistory: { state: 'missing' } } as never,
    })

    expect(row(coverage, 'trades')).toMatchObject({
      status: 'not_published',
      detail: 'We couldn’t bring across trade history from Fleaflicker for this league yet.',
    })
    /* The claim covers one bucket, not the league. */
    expect(row(coverage, 'drafts').status).toBe('none')
  })

  it('lets data on file win over a provider block that says missing', () => {
    const coverage = buildLeagueDataCoverage({
      ...base,
      trades: { seasons: [2025], undated: 0 },
      providerCoverage: { tradeHistory: { state: 'missing' } } as never,
    })
    expect(row(coverage, 'trades').status).toBe('available')
  })

  it('says "importing" only while the first sync has not landed', () => {
    const importing = buildLeagueDataCoverage({ ...base, syncStatus: 'pending', lastSyncedAt: null })
    expect(row(importing, 'drafts').status).toBe('importing')
    expect(row(importing, 'seasons').status).toBe('importing')

    /* `pending` beside a sync time is a stale label: something has synced. */
    const stale = buildLeagueDataCoverage({ ...base, syncStatus: 'pending', lastSyncedAt: new Date() })
    expect(row(stale, 'drafts').status).toBe('none')
  })

  it('refuses to call a row empty behind a failed sync', () => {
    expect(row(buildLeagueDataCoverage({ ...base, syncStatus: 'error' }), 'trades')).toMatchObject({
      status: 'unknown',
      detail: 'The last ESPN sync failed, so this may exist and not have been read.',
    })
  })

  it('calls seasons unknown only when every read failed', () => {
    const allFailed = buildLeagueDataCoverage({
      ...base,
      standings: null,
      drafts: null,
      trades: null,
      transactions: null,
      lineups: null,
      otherSeasons: null,
    })
    expect(row(allFailed, 'seasons').status).toBe('unknown')

    const oneRead = buildLeagueDataCoverage({ ...base, standings: null, drafts: null })
    expect(row(oneRead, 'seasons').status).toBe('none')
  })

  it('returns nothing for a native league', () => {
    expect(buildLeagueDataCoverage({ ...base, platform: 'allfantasy' })).toBeNull()
    expect(buildLeagueDataCoverage({ ...base, platform: null })).toBeNull()
  })
})

describe('describeSeasons', () => {
  it('writes a contiguous run as a range', () => {
    expect(describeSeasons([2023, 2021, 2022])).toBe('2021–2023')
  })

  it('lists seasons with a gap', () => {
    expect(describeSeasons([2019, 2023, 2021])).toBe('2019, 2021 and 2023')
  })

  it('handles one season and duplicates', () => {
    expect(describeSeasons([2025, 2025])).toBe('2025')
    expect(describeSeasons([])).toBe('')
  })
})
