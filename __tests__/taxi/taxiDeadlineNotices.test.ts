/**
 * Taxi deadline notices (phase 8, 2026-10-29): in the week a taxi deadline closes, owners are told
 * before it does and the commissioner gets one summary.
 */
import { describe, expect, it } from 'vitest'
import { taxiDeadlineMessages, taxiDeadlinesClosingThisWeek } from '@/lib/taxi/taxiDeadlineNotices'
import type { TaxiMoveRules } from '@/lib/taxi/taxiMoveRules'

const rules = (over: Partial<TaxiMoveRules> = {}): TaxiMoveRules => ({
  lockAfterWeek: 6,
  promotionDeadlineWeek: 10,
  lockBehavior: 'once_promoted_no_return',
  inSeasonMoves: true,
  postseasonMoves: false,
  ...over,
})

describe('which deadline closes this week', () => {
  it('the promotion deadline in its week, the lock in its own, and nothing in between', () => {
    expect(taxiDeadlinesClosingThisWeek(rules(), 'regular', 10)).toEqual(['promotion_closes'])
    expect(taxiDeadlinesClosingThisWeek(rules(), 'regular', 6)).toEqual(['lock_closes'])
    expect(taxiDeadlinesClosingThisWeek(rules(), 'regular', 7)).toEqual([])
    expect(taxiDeadlinesClosingThisWeek(rules({ lockAfterWeek: 10 }), 'regular', 10)).toEqual(['promotion_closes', 'lock_closes'])
  })

  it('nothing when there is no deadline, no in-season window, or the league is not playing', () => {
    expect(taxiDeadlinesClosingThisWeek(rules({ promotionDeadlineWeek: null, lockAfterWeek: null }), 'regular', 10)).toEqual([])
    expect(taxiDeadlinesClosingThisWeek(rules({ inSeasonMoves: false }), 'regular', 10)).toEqual([])
    expect(taxiDeadlinesClosingThisWeek(rules({ promotionDeadlineWeek: 15 }), 'playoffs', 15)).toEqual([])
    expect(taxiDeadlinesClosingThisWeek(rules(), 'offseason', 10)).toEqual([])
  })
})

describe('what is said', () => {
  const teams = [
    { ownerId: 'u1', teamName: 'A', taxiPlayers: ['Rookie One', 'Rookie Two'] },
    { ownerId: 'u2', teamName: 'B', taxiPlayers: [] },
    { ownerId: 'u3', teamName: 'C', taxiPlayers: ['Rookie Three'] },
  ]

  it('promotion deadline: only teams with taxi players, naming them; one summary for the commissioner', () => {
    const msgs = taxiDeadlineMessages({ kinds: ['promotion_closes'], week: 10, leagueName: 'Dyn', teams, commissionerId: 'c' })
    expect(msgs.filter((m) => m.audience === 'owner').map((m) => m.userId)).toEqual(['u1', 'u3'])
    expect(msgs.find((m) => m.userId === 'u1')!.body).toContain('Rookie One and Rookie Two are on your taxi squad')
    expect(msgs.find((m) => m.userId === 'u3')!.body).toContain('Rookie Three is on your taxi squad')
    const commish = msgs.filter((m) => m.audience === 'commissioner')
    expect(commish).toHaveLength(1)
    expect(commish[0]!.body).toContain('2 teams with 3 taxi players were told')
  })

  it('lock week: every team is told', () => {
    const msgs = taxiDeadlineMessages({ kinds: ['lock_closes'], week: 6, leagueName: 'Dyn', teams, commissionerId: 'c' })
    expect(msgs.filter((m) => m.audience === 'owner').map((m) => m.userId)).toEqual(['u1', 'u2', 'u3'])
    expect(msgs.find((m) => m.audience === 'commissioner')!.body).toContain('every team was told')
  })

  it('nothing at all in a week with no deadline', () => {
    expect(taxiDeadlineMessages({ kinds: [], week: 7, leagueName: 'Dyn', teams, commissionerId: 'c' })).toEqual([])
  })
})
