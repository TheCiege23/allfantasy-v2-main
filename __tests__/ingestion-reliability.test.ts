import { beforeEach, describe, expect, it, vi } from 'vitest'

// Phase-2 reliability primitives: ledger-driven week selection, partial-week recovery
// (the exact production failure from the 2026-07-21 release), stale-state sweep, and the
// atomic run lock. Concurrency and resume behavior are additionally proven on a live clone.

const statIngestionJobFindMany = vi.fn()
const statIngestionJobCreate = vi.fn()
const statIngestionJobUpdate = vi.fn()
const statIngestionJobUpdateMany = vi.fn()
const playerGameStatGroupBy = vi.fn()
const playerGameStatCount = vi.fn()
const playerGameFactGroupBy = vi.fn()
const syncJobRunUpdateMany = vi.fn()
const queryRaw = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    statIngestionJob: {
      findMany: (...a: unknown[]) => statIngestionJobFindMany(...a),
      create: (...a: unknown[]) => statIngestionJobCreate(...a),
      update: (...a: unknown[]) => statIngestionJobUpdate(...a),
      updateMany: (...a: unknown[]) => statIngestionJobUpdateMany(...a),
    },
    playerGameStat: {
      groupBy: (...a: unknown[]) => playerGameStatGroupBy(...a),
      count: (...a: unknown[]) => playerGameStatCount(...a),
    },
    playerGameFact: { groupBy: (...a: unknown[]) => playerGameFactGroupBy(...a) },
    syncJobRun: { updateMany: (...a: unknown[]) => syncJobRunUpdateMany(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))
vi.mock('@/lib/data-warehouse/HistoricalFactGenerator', () => ({ generateGameFactsFromExistingStats: vi.fn() }))

import {
  acquireRunLock,
  findWeeksNeedingWork,
  reconcilePlayerGameFacts,
  repairWeekFacts,
  sweepStaleIngestionState,
} from '@/lib/player-game-stats/importPlayerGameStats'

beforeEach(() => {
  vi.clearAllMocks()
  statIngestionJobCreate.mockResolvedValue({ id: 'ledger-1' })
  statIngestionJobUpdate.mockResolvedValue({})
})

describe('findWeeksNeedingWork — explicit completion, not stats-presence', () => {
  it('classifies missing / partial / completed correctly', async () => {
    statIngestionJobFindMany.mockResolvedValue([{ weekOrRound: 3 }]) // ledger says week 3 done
    playerGameStatGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } }, // reconciles → grandfathered complete
      { weekOrRound: 2, _count: { _all: 2300 } }, // facts missing → partial
      { weekOrRound: 3, _count: { _all: 100 } },  // ledger-complete wins regardless
    ])
    playerGameFactGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } },
      { weekOrRound: 2, _count: { _all: 0 } },
    ])

    const plan = await findWeeksNeedingWork(2025)
    expect(plan.completed).toEqual(expect.arrayContaining([1, 3]))
    expect(plan.partial).toEqual([2])
    expect(plan.missing).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('REGRESSION (release week 16): stats written, killed before facts → partial, not complete', async () => {
    statIngestionJobFindMany.mockResolvedValue([])
    playerGameStatGroupBy.mockResolvedValue([{ weekOrRound: 16, _count: { _all: 2436 } }])
    playerGameFactGroupBy.mockResolvedValue([]) // process died before fact generation

    const plan = await findWeeksNeedingWork(2025)
    expect(plan.partial).toEqual([16])
    expect(plan.completed).not.toContain(16)
  })
})

describe('repairWeekFacts — partial-week recovery without a provider call', () => {
  it('regenerates facts from existing stats and completes only on validation', async () => {
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    playerGameStatCount.mockResolvedValue(2436)
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2436, teamFacts: 0, sourcePlayerGameStats: 2436, sourceTeamGameStats: 0, warnings: [],
    })

    const report = await repairWeekFacts(2025, 16)
    expect(report.playerFactsGenerated).toBe(2436)
    expect(report.factStatus).toBe('repaired_COMPLETED')
    const statuses = statIngestionJobUpdate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status)
    expect(statuses).toEqual(['stats_written', 'facts_generated', 'completed'])
    // No provider fetch anywhere in this path — the fetcher is not even a parameter.
  })

  it('validation mismatch stays partial with the discrepancy recorded', async () => {
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    playerGameStatCount.mockResolvedValue(2436)
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'PARTIAL', playerFacts: 2000, teamFacts: 0, sourcePlayerGameStats: 2436, sourceTeamGameStats: 0, warnings: [],
    })

    const report = await repairWeekFacts(2025, 16)
    expect(report.factStatus).toBe('repair_mismatch')
    const last = statIngestionJobUpdate.mock.calls.at(-1)![0] as { data: { status: string; errorMessage?: string } }
    expect(last.data.status).toBe('partial')
    expect(last.data.errorMessage).toContain('stats=2436')
  })
})

describe('reconcilePlayerGameFacts', () => {
  it('dry-run reports would_repair for mismatched weeks and touches nothing', async () => {
    playerGameStatGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } },
      { weekOrRound: 2, _count: { _all: 2300 } },
    ])
    playerGameFactGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } },
      { weekOrRound: 2, _count: { _all: 1150 } },
    ])
    const report = await reconcilePlayerGameFacts({ season: 2025 })
    expect(report.dryRun).toBe(true)
    expect(report.weeks.find((w) => w.week === 1)?.action).toBe('skipped_healthy')
    expect(report.weeks.find((w) => w.week === 2)?.action).toBe('would_repair')
    expect(statIngestionJobCreate).not.toHaveBeenCalled()
  })

  it('apply repairs ONLY the mismatched week', async () => {
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    playerGameStatGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } },
      { weekOrRound: 2, _count: { _all: 2300 } },
    ])
    playerGameFactGroupBy.mockResolvedValue([
      { weekOrRound: 1, _count: { _all: 2280 } },
      { weekOrRound: 2, _count: { _all: 0 } },
    ])
    playerGameStatCount.mockResolvedValue(2300)
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2300, teamFacts: 0, sourcePlayerGameStats: 2300, sourceTeamGameStats: 0, warnings: [],
    })

    const report = await reconcilePlayerGameFacts({ season: 2025, dryRun: false })
    expect(report.repaired).toBe(1)
    expect(report.weeks.find((w) => w.week === 2)).toMatchObject({ action: 'repaired', factCountAfter: 2300 })
    expect(vi.mocked(generateGameFactsFromExistingStats)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generateGameFactsFromExistingStats)).toHaveBeenCalledWith('NFL', 2025, 2)
  })
})

describe('stale sweep + atomic lock', () => {
  it('sweeps stale running rows into truthful terminal states, preserving history', async () => {
    syncJobRunUpdateMany.mockResolvedValue({ count: 1 })
    statIngestionJobUpdateMany.mockResolvedValue({ count: 2 })

    const swept = await sweepStaleIngestionState()
    expect(swept).toEqual({ sweptRuns: 1, sweptLedger: 2 })
    const runCall = syncJobRunUpdateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(runCall.where.status).toBe('running')
    expect(runCall.data.status).toBe('timed_out')
    expect(String(runCall.data.errorMessage)).toContain('stale threshold')
    const ledgerCall = statIngestionJobUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(ledgerCall.data.status).toBe('abandoned')
    // History preserved: both are UPDATEs — the mock surface has no delete at all.
  })

  it('acquires the lock atomically and reports contention as null', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'lock-1' }])
    expect(await acquireRunLock('cron')).toBe('lock-1')
    queryRaw.mockResolvedValueOnce([]) // WHERE NOT EXISTS matched a live run → no row inserted
    expect(await acquireRunLock('cron')).toBeNull()
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })
})
