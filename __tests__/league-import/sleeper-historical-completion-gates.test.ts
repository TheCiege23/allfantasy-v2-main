import { describe, expect, it, vi, beforeEach } from 'vitest'

const draftFactFindFirst = vi.fn()
const draftFactDeleteMany = vi.fn()
const draftFactCreateMany = vi.fn()
const rosterSnapshotFindFirst = vi.fn()
const rosterSnapshotCreate = vi.fn()
const rosterSnapshotDeleteMany = vi.fn()
const leagueFindUnique = vi.fn()
const leagueSeasonFindFirst = vi.fn()
const transactionMock = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...args: unknown[]) => leagueFindUnique(...args) },
    leagueSeason: { findFirst: (...args: unknown[]) => leagueSeasonFindFirst(...args) },
    draftFact: {
      findFirst: (...args: unknown[]) => draftFactFindFirst(...args),
      deleteMany: (...args: unknown[]) => draftFactDeleteMany(...args),
      createMany: (...args: unknown[]) => draftFactCreateMany(...args),
    },
    rosterSnapshot: {
      findFirst: (...args: unknown[]) => rosterSnapshotFindFirst(...args),
      create: (...args: unknown[]) => rosterSnapshotCreate(...args),
      deleteMany: (...args: unknown[]) => rosterSnapshotDeleteMany(...args),
    },
    $transaction: (ops: unknown[]) => transactionMock(ops),
  },
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueDrafts: vi.fn(async () => []),
  getDraftPicks: vi.fn(async () => []),
  getLeagueUsers: vi.fn(async () => []),
  getLeagueRosters: vi.fn(async () => []),
}))

vi.mock('@/lib/league-import/sleeper/SleeperHistoricalLeagueChain', () => ({
  getSleeperHistoricalLeagueChain: vi.fn(),
}))

vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistDynastySeason: vi.fn(async () => undefined),
}))

import { getSleeperHistoricalLeagueChain } from '@/lib/league-import/sleeper/SleeperHistoricalLeagueChain'
import { getLeagueDrafts, getLeagueUsers, getLeagueRosters } from '@/lib/sleeper-client'
import { syncSleeperHistoricalDraftFactsAfterImport } from '@/lib/league-import/sleeper/SleeperHistoricalDraftSyncService'
import { syncSleeperHistoricalSeasonStateAfterImport } from '@/lib/league-import/sleeper/SleeperHistoricalSeasonStateSyncService'

const chainMock = vi.mocked(getSleeperHistoricalLeagueChain)

function threeSeasonChain() {
  return [
    { season: 2025, externalLeagueId: 'lg-2025', league: { season: '2025' } },
    { season: 2024, externalLeagueId: 'lg-2024', league: { season: '2024' } },
    { season: 2023, externalLeagueId: 'lg-2023', league: { season: '2023' } },
  ] as never
}

describe('Sleeper historical draft sync — completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      sport: 'nfl',
    })
    chainMock.mockResolvedValue(threeSeasonChain())
  })

  it('skips seasons that already have DraftFact rows and does not call the provider for them', async () => {
    // 2025 and 2024 already imported; only 2023 is missing.
    draftFactFindFirst.mockImplementation(async ({ where }: { where: { season: number } }) => {
      return where.season === 2023 ? null : { id: `existing-${where.season}` }
    })

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsConsidered).toBe(3)
    expect(result.seasonsSkippedAlreadyComplete).toBe(2)
    expect(result.providerCallsAvoided).toBe(2)
    // getLeagueDrafts should only have been called for the one missing season (2023).
    expect(getLeagueDrafts).toHaveBeenCalledTimes(1)
    expect(getLeagueDrafts).toHaveBeenCalledWith('lg-2023')
  })

  it('does not call the provider at all when every season is already complete', async () => {
    draftFactFindFirst.mockResolvedValue({ id: 'existing' })

    const result = await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1' })

    expect(result.skipped).toBe(true)
    expect(result.reason).toMatch(/already have imported draft data/)
    expect(result.seasonsSkippedAlreadyComplete).toBe(3)
    expect(getLeagueDrafts).not.toHaveBeenCalled()
    expect(draftFactDeleteMany).not.toHaveBeenCalled()
  })

  it('force=true re-fetches every season even when DraftFact rows already exist', async () => {
    draftFactFindFirst.mockResolvedValue({ id: 'existing' })

    await syncSleeperHistoricalDraftFactsAfterImport({ leagueId: 'league-1', force: true })

    // findFirst (the gate check) must never be consulted when forcing.
    expect(draftFactFindFirst).not.toHaveBeenCalled()
    expect(getLeagueDrafts).toHaveBeenCalledTimes(3)
  })
})

describe('Sleeper historical roster/season-state sync — completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({
      id: 'league-1',
      platform: 'sleeper',
      platformLeagueId: 'lg-current',
      sport: 'nfl',
    })
    chainMock.mockResolvedValue(threeSeasonChain())
    leagueSeasonFindFirst.mockResolvedValue(null)
  })

  it('skips seasons with an existing roster snapshot and avoids the users/rosters provider calls', async () => {
    rosterSnapshotFindFirst.mockImplementation(async ({ where }: { where: { season: number } }) => {
      return where.season === 2023 ? null : { id: `existing-${where.season}` }
    })

    const result = await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1' })

    expect(result.seasonsConsidered).toBe(3)
    expect(result.seasonsSkippedAlreadyComplete).toBe(2)
    expect(result.providerCallsAvoided).toBe(2)
    expect(getLeagueUsers).toHaveBeenCalledTimes(1)
    expect(getLeagueRosters).toHaveBeenCalledTimes(1)
  })

  it('force=true re-fetches every season even when a roster snapshot already exists', async () => {
    rosterSnapshotFindFirst.mockResolvedValue({ id: 'existing' })

    await syncSleeperHistoricalSeasonStateAfterImport({ leagueId: 'league-1', force: true })

    expect(rosterSnapshotFindFirst).not.toHaveBeenCalled()
    expect(getLeagueUsers).toHaveBeenCalledTimes(3)
  })
})
