import { describe, expect, it } from 'vitest'

import { MAX_PICKS, normalizePicks, resolveLeagueScope } from '@/lib/core-app/finderLeaguePicks'
import { countShares, shareOf } from '@/lib/core-app/playerSharesRank'

/* "Your shares" and "pick leagues" — the pure halves (Phase 2, 2026-09-27). */

describe('countShares', () => {
  const R = (leagueId: string, starters: string[], players: string[], reserve: string[] = [], taxi: string[] = []) => ({ leagueId, starters, reserve, taxi, players })

  it('counts one share per roster, and where he starts or sits on IR', () => {
    const out = countShares([
      R('A', ['1', '2'], ['1', '2', '3']),
      R('B', ['1'], ['1', '3', '4'], ['2']),
      R('C', [], ['1', '0'], [], ['5']),
    ])
    expect(out[0]).toEqual({ sleeperId: '1', leagues: 3, starts: 2, ir: 0, leagueIds: ['A', 'B', 'C'] })
    expect(out.find((r) => r.sleeperId === '2')).toMatchObject({ leagues: 2, starts: 1, ir: 1 })
    // A taxi player is still a share; an empty slot ("0") is nobody.
    expect(out.find((r) => r.sleeperId === '5')).toMatchObject({ leagues: 1, starts: 0 })
    expect(out.some((r) => r.sleeperId === '0')).toBe(false)
  })

  it('ranks most-held first, then most started', () => {
    const out = countShares([R('A', ['2'], ['1', '2']), R('B', [], ['1', '2']), R('C', [], ['3'])])
    expect(out.map((r) => r.sleeperId)).toEqual(['2', '1', '3'])
  })

  it('counts a league once even if two rosters for it are passed', () => {
    const out = countShares([R('A', [], ['1']), R('A', [], ['1'])])
    expect(out[0].leagues).toBe(1)
  })

  it('shareOf is a bounded fraction', () => {
    expect(shareOf(9, 49)).toBeCloseTo(0.1837, 3)
    expect(shareOf(3, 0)).toBe(0)
  })
})

describe('league picks', () => {
  const PLAYED = ['L1', 'L2', 'L3', 'L4']

  it('reads every league with no pick', () => {
    expect(resolveLeagueScope(PLAYED, null)).toEqual({ leagueIds: PLAYED, picked: false, count: 4, total: 4 })
    expect(resolveLeagueScope(PLAYED, [])).toMatchObject({ picked: false, count: 4 })
  })

  it('reads only the ticked leagues, in played order, and ignores ids the account does not play', () => {
    expect(resolveLeagueScope(PLAYED, ['L3', 'L1', 'FOREIGN'])).toEqual({ leagueIds: ['L1', 'L3'], picked: true, count: 2, total: 4 })
  })

  it('falls back to ALL when nothing ticked survives — an empty board would read as "you roster nobody"', () => {
    expect(resolveLeagueScope(PLAYED, ['GONE'])).toMatchObject({ leagueIds: PLAYED, picked: false })
  })

  it('shape-checks what a client sends', () => {
    expect(normalizePicks(['a', ' b ', 'a', '', 5, 'x'.repeat(65)])).toEqual(['a', 'b'])
    expect(normalizePicks(null)).toBeNull()
    expect(normalizePicks('L1')).toBeNull()
    expect(normalizePicks(Array.from({ length: 400 }, (_, i) => `L${i}`))).toHaveLength(MAX_PICKS)
  })
})
