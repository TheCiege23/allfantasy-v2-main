import { describe, expect, it } from 'vitest'
import { leagueTradeSourceBranches } from '@/lib/core-app/leagueTradeSources'

describe('LeagueTrade league filter: one join per platform', () => {
  it('groups leagues by platform, so a one-platform account gets exactly one branch', () => {
    expect(leagueTradeSourceBranches([
      { platform: 'sleeper', platformLeagueId: 'b' },
      { platform: 'Sleeper', platformLeagueId: 'a' },
      { platform: null, platformLeagueId: 'c' },
    ])).toEqual([{ platform: 'sleeper', history: { sleeperLeagueId: { in: ['a', 'b', 'c'] } } }])
  })

  it('keeps the same provider id on two platforms in two branches, never merged', () => {
    expect(leagueTradeSourceBranches([
      { platform: 'espn', platformLeagueId: '123' },
      { platform: 'sleeper', platformLeagueId: '123' },
    ])).toEqual([
      { platform: 'espn', history: { sleeperLeagueId: { in: ['123'] } } },
      { platform: 'sleeper', history: { sleeperLeagueId: { in: ['123'] } } },
    ])
  })

  it('drops leagues without a provider id and repeats of the same league', () => {
    expect(leagueTradeSourceBranches([
      { platform: 'sleeper', platformLeagueId: 'x' },
      { platform: 'sleeper', platformLeagueId: 'x' },
      { platform: 'sleeper', platformLeagueId: null },
      { platform: 'sleeper' },
    ])).toEqual([{ platform: 'sleeper', history: { sleeperLeagueId: { in: ['x'] } } }])
    expect(leagueTradeSourceBranches([])).toEqual([])
  })

  it('matches exactly the (platform, league) pairs the old one-branch-per-league filter matched', () => {
    const leagues = [
      { platform: 'sleeper', platformLeagueId: 's1' }, { platform: 'espn', platformLeagueId: 'e1' },
      { platform: 'sleeper', platformLeagueId: 's2' }, { platform: 'fantrax', platformLeagueId: 's1' },
    ]
    const old = new Set(leagues.map((l) => `${l.platform}|${l.platformLeagueId}`))
    const now = new Set(leagueTradeSourceBranches(leagues).flatMap((b) => b.history.sleeperLeagueId.in.map((id) => `${b.platform}|${id}`)))
    expect(now).toEqual(old)
    // And a pair that was never asked for is still not matched.
    expect(now.has('espn|s1')).toBe(false)
  })
})
