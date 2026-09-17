import { describe, expect, it } from 'vitest'

import { buildTeamProfile, MIN_GAMES_FOR_STANCE } from '@/lib/trade-value/teamProfile'

/**
 * One game is not a season (2026-09-17). Win percentage over one game is 0 or 1, so a 0-1 team read
 * as a "rebuilder" and a 1-0 team as a "contender" on the /core player card, in trade discovery and in
 * the commissioner review. The stance now waits for `MIN_GAMES_FOR_STANCE` games.
 */
const profile = (wins: number, losses: number, ties = 0, playoffSeed: number | null = null) =>
  buildTeamProfile({ rosterId: 'r', wins, losses, ties, pointsFor: 0, playoffSeed, leagueSize: 12, positions: [] })

describe('buildTeamProfile — stance early in the season', () => {
  it('waits four games', () => {
    expect(MIN_GAMES_FOR_STANCE).toBe(4)
  })

  it.each([
    [0, 0],
    [0, 1],
    [1, 0],
    [0, 3],
    [3, 0],
    [2, 1],
  ])('%i-%i is middle and not settled', (w, l) => {
    const p = profile(w, l)
    expect(p.stance).toBe('middle')
    expect(p.stanceSettled).toBe(false)
  })

  it('a tie counts as a game played', () => {
    expect(profile(3, 0, 1).stanceSettled).toBe(true)
    expect(profile(2, 0, 1).stanceSettled).toBe(false)
  })

  it('from the fourth game the record decides, as before', () => {
    expect(profile(4, 0)).toMatchObject({ stance: 'contender', stanceSettled: true })
    expect(profile(0, 4)).toMatchObject({ stance: 'rebuilder', stanceSettled: true })
    expect(profile(2, 2)).toMatchObject({ stance: 'middle', stanceSettled: true })
    expect(profile(5, 1, 0, 11)).toMatchObject({ stance: 'middle', stanceSettled: true })
  })

  it('winPct is still reported early — only the label waits', () => {
    expect(profile(0, 1).winPct).toBe(0)
    expect(profile(1, 0).winPct).toBe(1)
  })
})
