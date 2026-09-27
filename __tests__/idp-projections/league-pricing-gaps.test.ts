import { beforeEach, describe, expect, it, vi } from 'vitest'

const load = vi.hoisted(() => vi.fn())
vi.mock('@/lib/idp-projections/loadIdpProjections', () => ({ loadIdpProjections: load }))
import { priceIdpBoard } from '@/lib/idp-projections/leagueIdpVorp'

const ids = ['starter', 'replacement', 'rookie', 'reserve', 'unknown']
const aggregate = vi.fn()
const prisma = {
  sportsPlayer: { findMany: vi.fn(async () => ids.map((sleeperId) => ({ sleeperId, position: 'LB' }))) },
  playerGameStat: { aggregate },
} as never
const args = { prisma, scoring: { idp_tkl_solo: 1 }, sleeperIds: ids, rosterSlots: ['LB'], numTeams: 1 }

beforeEach(() => {
  aggregate.mockReset().mockResolvedValueOnce({ _max: { season: 2026 } }).mockResolvedValueOnce({ _max: { weekOrRound: 2 } })
  load.mockResolvedValue({ bySleeperId: new Map([
    ['starter', { ok: true, statLine: { idp_tkl_solo: 10 } }],
    ['replacement', { ok: true, statLine: { idp_tkl_solo: 4 } }],
    ['rookie', { ok: false, reason: 'insufficient_sample', detail: 'Two games' }],
    ['reserve', { ok: false, reason: 'no_defensive_production', detail: 'Special teams only' }],
    ['unknown', { ok: false, reason: 'no_history', detail: 'No logs' }],
  ]) })
})

describe('league defender pricing gaps', () => {
  it('does not guess a projection week when the latest-period read fails', async () => {
    aggregate.mockReset().mockResolvedValueOnce({ _max: { season: 2026 } }).mockRejectedValueOnce(new Error('Unavailable'))
    const board = await priceIdpBoard(args)
    expect(board.projectedFor).toBeNull()
    expect(board.unpricedReasonBySleeperId?.get('starter')?.code).toBe('feed_unavailable')
    expect(board.valueBySleeperId.size).toBe(0)
  })
  it('reports an outage rather than claiming the history store contains no records', async () => {
    aggregate.mockReset().mockRejectedValue(new Error('Unavailable'))
    const board = await priceIdpBoard(args)
    expect(board.unpricedReasonBySleeperId?.get('reserve')?.code).toBe('feed_unavailable')
    expect(board.valueBySleeperId.size).toBe(0)
  })
  it('retains distinct refusals alongside real replacement-based prices', async () => {
    const board = await priceIdpBoard(args)
    expect(board.skipped).toBeNull()
    expect(board.coverage).toEqual({ defenders: 5, projected: 2, priced: 2 })
    expect(board.vorpBySleeperId.get('starter')).toBe(6)
    expect(board.valueBySleeperId.get('starter')).toBeGreaterThan(board.valueBySleeperId.get('replacement')!)
    expect(board.unpricedReasonBySleeperId?.get('rookie')?.code).toBe('idp_insufficient_sample')
    expect(board.unpricedReasonBySleeperId?.get('reserve')?.code).toBe('idp_no_defensive_production')
    expect(board.unpricedReasonBySleeperId?.get('unknown')?.code).toBe('idp_no_history')
    expect(board.unpricedReasonBySleeperId?.has('starter')).toBe(false)
    expect(board.valueBySleeperId.has('reserve')).toBe(false)
  })

  it('retains player-level reasons and the projection period when nobody can be priced', async () => {
    load.mockResolvedValue({ bySleeperId: new Map(ids.map((id) => [id, { ok: false, reason: 'insufficient_sample', detail: 'Two games' }])) })
    const board = await priceIdpBoard(args)
    expect(board.skipped).toBe('valuation_refused')
    expect(board.projectedFor).toEqual({ season: 2026, week: 3 })
    expect(board.unpricedReasonBySleeperId?.size).toBe(5)
    expect(board.valueBySleeperId.size).toBe(0)
    expect([...board.unpricedReasonBySleeperId!.values()].every((r) => r.code === 'idp_insufficient_sample')).toBe(true)
  })

  it('distinguishes missing league replacement inputs from missing player history', async () => {
    const board = await priceIdpBoard({ ...args, rosterSlots: ['QB'] })
    expect(board.skipped).toBe('valuation_refused')
    expect(board.unpricedReasonBySleeperId?.get('starter')?.code).toBe('idp_replacement_unavailable')
    expect(board.unpricedReasonBySleeperId?.get('rookie')?.code).toBe('idp_insufficient_sample')
  })

  it('reports missing stored history for known defenders without inventing prices', async () => {
    aggregate.mockReset().mockResolvedValue({ _max: { season: null } })
    const board = await priceIdpBoard(args)
    expect(board.skipped).toBe('no_projection_history')
    expect(board.coverage.defenders).toBe(5)
    expect(board.unpricedReasonBySleeperId?.get('reserve')?.code).toBe('idp_no_history')
    expect(board.valueBySleeperId.size).toBe(0)
  })
})
