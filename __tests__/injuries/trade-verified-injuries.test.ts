import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: h.findMany } } }))

import { fetchVerifiedTradeInjuries } from '@/lib/trade-engine/fetchVerifiedInjuries'

/*
 * The trade assemblers (league-context, trade-context) kept the newest row per NAME, so a trade
 * involving the Vikings WR Justin Jefferson read a Browns LB's "Active" whenever that row was newer.
 */
const at = (h: number) => new Date(Date.UTC(2026, 9, 11, h))
const rows = [
  { playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Active', type: null, description: null, date: at(12), fetchedAt: at(12) },
  { playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Questionable', type: 'Ankle', description: 'Limited Friday', date: at(9), fetchedAt: at(9) },
]

describe('fetchVerifiedTradeInjuries', () => {
  beforeEach(() => h.findMany.mockResolvedValue(rows))

  it("🛑 the roster's team picks its own athlete, not the newest row with that name", async () => {
    const m = await fetchVerifiedTradeInjuries([{ name: 'Justin Jefferson', team: 'MIN', position: 'WR' }], 'test')
    expect(m.get('Justin Jefferson')?.status).toBe('Questionable')
    expect(m.get('Justin Jefferson')?.type).toBe('Ankle')
  })

  it('a bare name shared by two athletes is left out rather than guessed', async () => {
    const m = await fetchVerifiedTradeInjuries([{ name: 'Justin Jefferson' }], 'test')
    expect(m.has('Justin Jefferson')).toBe(false)
  })

  it('keys by the name the caller asked with, and a unique name needs no team', async () => {
    h.findMany.mockResolvedValue([{ ...rows[1], playerName: 'Rome Odunze', team: 'Chicago Bears', status: 'Out' }])
    const m = await fetchVerifiedTradeInjuries([{ name: 'Rome Odunze' }], 'test')
    expect(m.get('Rome Odunze')?.status).toBe('Out')
  })
})
