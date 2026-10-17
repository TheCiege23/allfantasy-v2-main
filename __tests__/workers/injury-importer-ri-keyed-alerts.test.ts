import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Injury push alerts resolve recipients through RI-keyed lookups (`ownersByPlayerId`,
 * `headshotsByRiId`). Only rows whose playerId IS a Rolling Insights id may reach them — measured
 * 2026-10-12, every `sleeper_live` Out row whose id collided with an RI id belonged to someone else.
 */

const apiChainFetch = vi.fn()
const sportsInjuryFindMany = vi.fn()
const ownersByPlayerId = vi.fn()
const headshotsByRiId = vi.fn()
const ingest = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsInjury: { findMany: (...a: unknown[]) => sportsInjuryFindMany(...a) },
    injuryReportRecord: { upsert: vi.fn(() => ({})) },
    $transaction: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/workers/api-chain', () => ({ apiChain: { fetch: (...a: unknown[]) => apiChainFetch(...a) } }))
vi.mock('@/lib/notification-engine', () => ({
  ingest: (...a: unknown[]) => ingest(...a),
  injuryAlert: (opts: Record<string, unknown>) => ({ type: 'injury_alert', ...opts }),
}))
vi.mock('@/lib/live/bigPlayNotifier', () => ({
  ownersByPlayerId: (...a: unknown[]) => ownersByPlayerId(...a),
  headshotsByRiId: (...a: unknown[]) => headshotsByRiId(...a),
}))

function legacy(over: Record<string, unknown>) {
  return {
    playerId: null,
    externalId: 'ext',
    playerName: 'X',
    team: 'ATL',
    status: 'Out',
    type: null,
    description: null,
    date: new Date('2026-10-11T12:00:00Z'),
    fetchedAt: new Date('2026-10-11T12:00:00Z'),
    week: 6,
    source: 'rolling_insights',
    ...over,
  }
}

describe('runInjuryImporter — alerts only for Rolling Insights ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Every id "has" an owner, so any id that reaches the lookup would produce an alert.
    ownersByPlayerId.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, [`user-of-${id}`]])))
    headshotsByRiId.mockResolvedValue(new Map())
  })

  it('legacy branch: only rolling_insights rows with a playerId reach the RI lookups', async () => {
    apiChainFetch.mockResolvedValue({ data: [], source: 'cache' })
    sportsInjuryFindMany.mockResolvedValue([
      legacy({ playerId: '7408', playerName: 'Bijan Robinson', source: 'rolling_insights' }),
      legacy({ playerId: '9509', playerName: 'Bijan Robinson', source: 'sleeper_live' }),
      legacy({ playerId: null, externalId: '4430807', playerName: 'Somebody', source: 'espn' }),
    ])
    const { runInjuryImporter } = await import('@/lib/workers/injury-importer')
    await runInjuryImporter({ sports: ['NFL'], week: 6 })

    expect(ownersByPlayerId).toHaveBeenCalledTimes(1)
    expect(ownersByPlayerId.mock.calls[0]![0]).toEqual(['7408'])
    expect(ingest).toHaveBeenCalledTimes(1)
    expect((ingest.mock.calls[0]![0] as { userIds: string[] }).userIds).toEqual(['user-of-7408'])
  })

  it('legacy branch reads live rows only', async () => {
    apiChainFetch.mockResolvedValue({ data: [], source: 'cache' })
    sportsInjuryFindMany.mockResolvedValue([])
    const { runInjuryImporter } = await import('@/lib/workers/injury-importer')
    await runInjuryImporter({ sports: ['NFL'], week: 6 })
    const where = sportsInjuryFindMany.mock.calls[0]![0].where
    expect(where.sport).toBe('NFL')
    expect(where.expiresAt?.gt).toBeInstanceOf(Date)
  })

  it('live branch: a cached (mixed-source) answer imports but alerts nobody', async () => {
    apiChainFetch.mockResolvedValue({
      source: 'cache',
      data: [{ playerId: '9509', playerName: 'Bijan Robinson', team: 'ATL', status: 'Out' }],
    })
    const { runInjuryImporter } = await import('@/lib/workers/injury-importer')
    const result = await runInjuryImporter({ sports: ['NFL'], week: 6 })
    expect(result.imported).toBe(1)
    expect(ownersByPlayerId).not.toHaveBeenCalled()
    expect(ingest).not.toHaveBeenCalled()
  })

  it('live branch: an answer from Rolling Insights itself does alert', async () => {
    apiChainFetch.mockResolvedValue({
      source: 'rolling_insights',
      data: [{ playerId: '7408', playerName: 'Bijan Robinson', team: 'ATL', status: 'Out' }],
    })
    const { runInjuryImporter } = await import('@/lib/workers/injury-importer')
    await runInjuryImporter({ sports: ['NFL'], week: 6 })
    expect(ownersByPlayerId.mock.calls[0]![0]).toEqual(['7408'])
    expect(ingest).toHaveBeenCalledTimes(1)
  })
})
