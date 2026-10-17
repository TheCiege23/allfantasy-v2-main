import { describe, expect, it } from 'vitest'
import { buildLeaguesAtAGlance, isClose } from '@/lib/live/leaguesAtAGlance'
import { gameStage, groupByStage } from '@/lib/live/gameStage'
import type { RailMatchup, RailStanding } from '@/lib/core-app/railMatchups'

function m(over: Partial<RailMatchup> = {}): RailMatchup {
  return {
    leagueId: 'L',
    yourTeam: 'Me',
    yourAvatarUrl: null,
    yourScore: 0,
    yourProjection: null,
    opponentTeam: 'Them',
    opponentAvatarUrl: null,
    opponentScore: 0,
    opponentProjection: null,
    unpaired: false,
    standing: null,
    scored: true,
    freshAt: null,
    source: 'live_cache',
    season: 2026,
    week: 5,
    ...over,
  }
}

const standing = (over: Partial<RailStanding> = {}): RailStanding => ({
  rank: 8,
  outOf: 14,
  overCut: 43.2,
  basis: 'points',
  placesAboveCut: 6,
  cutLine: 83.5,
  elimination: true,
  ...over,
})

const league = (id: string, sport = 'NFL') => ({ id, name: `League ${id}`, sport })

describe('isClose', () => {
  it('uses 10% of the bigger score, with a 5-point floor', () => {
    expect(isClose(110, 100)).toBe(true)
    expect(isClose(115, 100)).toBe(false)
    expect(isClose(9, 4)).toBe(true) // floor: 5 points early in the day
    expect(isClose(1000, 905)).toBe(true) // an NBA-sized week
  })
})

describe('buildLeaguesAtAGlance', () => {
  it('says nothing when the rail read failed, rather than claiming a quiet week', () => {
    expect(buildLeaguesAtAGlance(null, [league('a')], 'NFL')).toBeNull()
  })

  it('counts ahead, behind, close and not started, and only for this tab’s sport', () => {
    const byLeague = {
      a: m({ leagueId: 'a', yourScore: 120, opponentScore: 80 }),
      b: m({ leagueId: 'b', yourScore: 90, opponentScore: 95 }),
      c: m({ leagueId: 'c', scored: false }),
      d: m({ leagueId: 'd', yourScore: 50, opponentScore: 10 }), // an NBA league
    }
    const g = buildLeaguesAtAGlance(byLeague, [league('a'), league('b'), league('c'), league('d', 'NBA')], 'NFL')!
    expect(g.rows.map((r) => r.leagueId)).toEqual(['b', 'a', 'c'])
    expect(g.counts).toEqual({ ahead: 1, behind: 1, level: 0, close: 1, pending: 1 })
    expect(g.attention.map((r) => r.leagueId)).toEqual(['b'])
    expect(g.rows.find((r) => r.leagueId === 'c')!.line).toBe('Not started')
    expect(g.rows.find((r) => r.leagueId === 'b')!.line).toBe('90.0–95.0 · behind by 5.0')
  })

  it('puts an elimination league on the block first, and names the cut instead of an opponent', () => {
    const byLeague = {
      safe: m({ leagueId: 'safe', unpaired: true, standing: standing() }),
      block: m({ leagueId: 'block', unpaired: true, standing: standing({ rank: 14, overCut: null, placesAboveCut: 0 }) }),
      bubble: m({ leagueId: 'bubble', unpaired: true, standing: standing({ rank: 12, overCut: 3.1, placesAboveCut: 1 }) }),
      losing: m({ leagueId: 'losing', yourScore: 40, opponentScore: 100 }),
    }
    const g = buildLeaguesAtAGlance(byLeague, Object.keys(byLeague).map((id) => league(id)), 'NFL')!
    expect(g.attention.map((r) => r.leagueId)).toEqual(['block', 'losing', 'bubble'])
    expect(g.rows.find((r) => r.leagueId === 'block')!.line).toBe('#14 of 14 · on the block')
    expect(g.rows.find((r) => r.leagueId === 'safe')!.line).toBe('#8 of 14 · 43.2 over the cut')
    expect(g.counts).toMatchObject({ ahead: 2, behind: 2, close: 2 })
  })

  it('does not count a league you were chopped from', () => {
    const byLeague = { out: m({ leagueId: 'out', unpaired: true, eliminated: true }) }
    expect(buildLeaguesAtAGlance(byLeague, [league('out')], 'NFL')).toBeNull()
  })

  it('says a projected rank is projected', () => {
    const byLeague = { p: m({ leagueId: 'p', unpaired: true, standing: standing({ basis: 'projected' }) }) }
    expect(buildLeaguesAtAGlance(byLeague, [league('p')], 'NFL')!.rows[0]!.line).toMatch(/\(projected\)$/)
  })
})

describe('gameStage / groupByStage', () => {
  const g = (id: string, isLive: boolean, completed: boolean) => ({ id, isLive, completed })
  it('classifies', () => {
    expect(gameStage(g('x', true, false))).toBe('live')
    expect(gameStage(g('x', false, false))).toBe('upcoming')
    expect(gameStage(g('x', false, true))).toBe('final')
  })
  it('puts live first, then upcoming, then final, keeping order inside each stage', () => {
    const out = groupByStage([g('f1', false, true), g('l1', true, false), g('u1', false, false), g('l2', true, false), g('f2', false, true)])
    expect(out.map((x) => x.id)).toEqual(['l1', 'l2', 'u1', 'f1', 'f2'])
  })
})
