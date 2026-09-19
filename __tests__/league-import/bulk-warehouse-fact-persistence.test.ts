import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeRaw: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { $executeRaw: mocks.executeRaw },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.executeRaw.mockResolvedValue(1)
})

describe('bulk warehouse fact persistence', () => {
  it('writes an entire season of standings in one upsert', async () => {
    const { persistSeasonStandingFacts } = await import(
      '@/lib/league-import/bulkWarehouseFactPersistence'
    )
    const rows = Array.from({ length: 32 }, (_, index) => ({
      leagueId: 'league-1',
      sport: 'NFL',
      season: 2026,
      teamId: `team-${index + 1}`,
      wins: index,
      losses: 31 - index,
      ties: 0,
      pointsFor: 100 + index,
      pointsAgainst: 90 + index,
      rank: index + 1,
    }))

    await expect(persistSeasonStandingFacts(rows)).resolves.toBe(32)
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('INSERT INTO "dw_season_standing_facts"')
    expect(sql).toContain('ON CONFLICT ("leagueId", "season", "teamId")')
  })

  it('bounds large imports to 250 rows per statement', async () => {
    const { persistSeasonStandingFacts } = await import(
      '@/lib/league-import/bulkWarehouseFactPersistence'
    )
    const rows = Array.from({ length: 251 }, (_, index) => ({
      leagueId: 'league-1', sport: 'NFL', season: 2026, teamId: `team-${index}`,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, rank: null,
    }))

    await expect(persistSeasonStandingFacts(rows)).resolves.toBe(251)
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2)
  })

  it('isolates a bad fact while preserving valid facts', async () => {
    const { persistSeasonStandingFacts } = await import(
      '@/lib/league-import/bulkWarehouseFactPersistence'
    )
    mocks.executeRaw
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('bad row'))

    const written = await persistSeasonStandingFacts([
      { leagueId: 'league-1', sport: 'NFL', season: 2026, teamId: 'good', wins: 1, losses: 0, ties: 0, pointsFor: 1, pointsAgainst: 0, rank: 1 },
      { leagueId: 'league-1', sport: 'NFL', season: 2026, teamId: 'bad', wins: 0, losses: 1, ties: 0, pointsFor: 0, pointsAgainst: 1, rank: 2 },
    ])

    expect(written).toBe(1)
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('persists provider transaction facts in one immutable bulk insert', async () => {
    const { persistProviderTransactionFacts } = await import(
      '@/lib/league-import/persistProviderTransactionFacts'
    )
    const written = await persistProviderTransactionFacts([
      {
        provider: 'espn', upstreamTransactionId: 'tx-1', entryIndex: 0,
        leagueId: 'league-1', sport: 'NFL', type: 'trade',
        payload: { status: 'complete' }, season: 2026, weekOrPeriod: 1,
      },
      {
        provider: 'espn', upstreamTransactionId: 'tx-2', entryIndex: 0,
        leagueId: 'league-1', sport: 'NFL', type: 'waiver',
        payload: { status: 'complete' }, season: 2026, weekOrPeriod: 2,
      },
    ])

    expect(written).toBe(2)
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('INSERT INTO "dw_transaction_facts"')
    expect(sql).toContain('ON CONFLICT ("transactionId") DO NOTHING')
  })

  it('bulk-updates mutable Sleeper facts and keeps the latest duplicate payload', async () => {
    const { persistMutableTransactionFacts } = await import(
      '@/lib/league-import/bulkWarehouseFactPersistence'
    )
    const base = {
      transactionId: 'tx-1:roster-1', leagueId: 'league-1', sport: 'NFL', type: 'trade',
      playerId: null, managerId: 'roster-1', rosterId: 'roster-1', season: 2026,
      weekOrPeriod: 1,
    }

    const written = await persistMutableTransactionFacts([
      { ...base, payload: { status: 'pending' } },
      { ...base, payload: { status: 'complete' } },
    ])

    expect(written).toBe(2)
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('ON CONFLICT ("transactionId")')
    const joined = mocks.executeRaw.mock.calls[0][1] as { values?: unknown[] }
    expect(joined.values).toContain(JSON.stringify({ status: 'complete' }))
    expect(joined.values).not.toContain(JSON.stringify({ status: 'pending' }))
  })
})
