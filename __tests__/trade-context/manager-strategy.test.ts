import { describe, expect, it, vi } from 'vitest'

import {
  getTradeManagerStrategy,
  isTradeManagerStrategy,
  saveTradeManagerStrategy,
} from '@/lib/league-trade-engine/managerStrategy'

describe('league trade manager strategy', () => {
  it('accepts only the three supported manager-confirmed objectives', () => {
    expect(['win-now', 'balanced', 'rebuild'].every(isTradeManagerStrategy)).toBe(true)
    expect(isTradeManagerStrategy('contender-ish')).toBe(false)
    expect(isTradeManagerStrategy(null)).toBe(false)
  })

  it('stores strategy by league and user, including the roster identity', async () => {
    const upsert = vi.fn().mockResolvedValue({ active: 'rebuild', rosterId: 'r1', confirmedAt: new Date() })
    await saveTradeManagerStrategy({ leagueId: 'l1', userId: 'u1', rosterId: 'r1', active: 'rebuild' }, {
      tradeManagerStrategy: { upsert } as never,
    })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId_userId: { leagueId: 'l1', userId: 'u1' } },
      create: expect.objectContaining({ active: 'rebuild', rosterId: 'r1', source: 'manager_confirmed' }),
      update: expect.objectContaining({ active: 'rebuild', rosterId: 'r1', source: 'manager_confirmed' }),
    }))
  })

  it('does not turn an unknown stored value into a grading strategy', async () => {
    const findUnique = vi.fn().mockResolvedValue({ active: 'maybe', rosterId: null, confirmedAt: new Date() })
    await expect(getTradeManagerStrategy('l1', 'u1', {
      tradeManagerStrategy: { findUnique } as never,
    })).resolves.toBeNull()
  })
})
