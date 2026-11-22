import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ groupBy: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTradeInterest: db } }))

import { readTradeInterest, setTradeInterest, validPlayerId } from '@/lib/league/tradeInterest'

const missingTable = Object.assign(new Error('The table `league_trade_interests` does not exist'), { code: 'P2021' })

describe('trade interest (the AF crest)', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset()
  })

  it('reads anonymous counts per player and the viewer’s own marks', async () => {
    db.groupBy.mockResolvedValue([{ playerId: 'p1', _count: { _all: 3 } }, { playerId: 'p2', _count: { _all: 1 } }])
    db.findMany.mockResolvedValue([{ playerId: 'p1' }])
    expect(await readTradeInterest('L', 'me')).toEqual({ available: true, counts: { p1: 3, p2: 1 }, mine: ['p1'] })
    expect(db.findMany).toHaveBeenCalledWith({ where: { leagueId: 'L', userId: 'me' }, select: { playerId: true } })
  })

  it('answers "not available" before the migration is applied, instead of throwing', async () => {
    db.groupBy.mockRejectedValue(missingTable)
    db.findMany.mockRejectedValue(missingTable)
    expect(await readTradeInterest('L', 'me')).toEqual({ available: false, counts: {}, mine: [] })
    db.upsert.mockRejectedValue(missingTable)
    expect(await setTradeInterest({ leagueId: 'L', userId: 'me', playerId: 'p1', interested: true })).toEqual({ ok: false, unavailable: true })
  })

  it('marks idempotently and returns the new count', async () => {
    db.upsert.mockResolvedValue({})
    db.count.mockResolvedValue(4)
    expect(await setTradeInterest({ leagueId: 'L', userId: 'me', playerId: 'p1', interested: true })).toEqual({ ok: true, count: 4 })
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId_userId_playerId: { leagueId: 'L', userId: 'me', playerId: 'p1' } }, update: {} }))
  })

  it('unmarks only the viewer’s own row', async () => {
    db.deleteMany.mockResolvedValue({ count: 1 })
    db.count.mockResolvedValue(2)
    await setTradeInterest({ leagueId: 'L', userId: 'me', playerId: 'p1', interested: false })
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { leagueId: 'L', userId: 'me', playerId: 'p1' } })
  })

  it('rejects empty and oversized player ids', () => {
    expect(validPlayerId('4017')).toBe(true)
    expect(validPlayerId('')).toBe(false)
    expect(validPlayerId('x'.repeat(65))).toBe(false)
    expect(validPlayerId(42)).toBe(false)
  })
})
