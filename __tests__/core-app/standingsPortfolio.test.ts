import { describe, expect, it } from 'vitest'

import type { OutlookLeague, OutlookTeam, SeasonOutlook } from '@/lib/core-app/seasonOutlook'
import { buildStandingsPortfolio, groupWithheld, tierOf } from '@/lib/core-app/standingsPortfolio'

function team(over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: '1',
    name: 'You',
    isYou: true,
    wins: 3,
    losses: 0,
    pointsFor: 400,
    seed: 1,
    playoffPct: 90,
    byePct: 40,
    titlePct: 20,
    missPct: 10,
    range: null,
    status: null,
    modelled: true,
    weeksFitted: 3,
    weeklyMean: 130,
    expectedWins: 3,
    schedule: null,
    ...over,
  }
}

function league(id: string, you: Partial<OutlookTeam> | null, over: Partial<OutlookLeague> = {}): OutlookLeague {
  const me = you ? team(you) : null
  return {
    leagueId: id,
    leagueName: `League ${id}`,
    platform: 'sleeper',
    season: 2026,
    weeksRemaining: 11,
    playoffTeams: 6,
    byeTeams: 2,
    you: me,
    teams: Array.from({ length: 12 }, (_, i) => team({ rosterId: String(i), isYou: false, seed: i + 1 })),
    whatDecidesIt: 'Get to 8 wins',
    href: `/core/standings?league=${id}`,
    milestones: null,
    assumptions: {} as OutlookLeague['assumptions'],
    focus: null,
    ...over,
  }
}

function outlook(leagues: OutlookLeague[], over: Partial<SeasonOutlook> = {}): SeasonOutlook {
  return {
    leagues,
    summary: { makingPlayoffs: 0, clinched: 0, onTheBubble: 0, onByePace: 0, bestTitle: null },
    weekThatMatters: null,
    swingByLeague: {},
    priorities: [],
    basis: '10,000 runs.',
    withheld: [],
    firstKickoffAt: null,
    generatedAt: '2026-10-01T00:00:00Z',
    runs: { reused: 0, computed: 0 },
    ...over,
  }
}

describe('tierOf', () => {
  it('trusts arithmetic status over a rounded percentage', () => {
    expect(tierOf(97, 'clinched')).toBe('clinched')
    expect(tierOf(3, 'eliminated')).toBe('out')
  })

  it('reads a percentage that rounds to 0 or 100 as settled', () => {
    expect(tierOf(99.6, null)).toBe('clinched')
    expect(tierOf(0.3, null)).toBe('out')
  })

  it('splits the contested middle on the same lines as before', () => {
    expect(tierOf(60, null)).toBe('control')
    expect(tierOf(59, null)).toBe('bubble')
    expect(tierOf(25, null)).toBe('bubble')
    expect(tierOf(24, null)).toBe('longshot')
  })
})

describe('buildStandingsPortfolio', () => {
  it('excludes and counts a league whose team we could not identify', () => {
    const p = buildStandingsPortfolio(outlook([league('a', {}), league('b', null)]))
    expect(p.rows).toHaveLength(1)
    expect(p.unidentified).toBe(1)
  })

  it('never states a 0-0 record and does not count an unplayed seed as a playoff spot', () => {
    const p = buildStandingsPortfolio(outlook([league('a', { wins: 0, losses: 0, seed: 1 })]))
    expect(p.rows[0].record).toBeNull()
    expect(p.stats.inFieldNow).toBe(0)
    expect(p.stats.topSeeds).toBe(0)
  })

  it('sums playoff odds into expected berths', () => {
    const p = buildStandingsPortfolio(
      outlook([league('a', { playoffPct: 90 }), league('b', { playoffPct: 45, seed: 7 })]),
    )
    expect(p.stats.expectedBerths).toBeCloseTo(1.35)
    expect(p.stats.inFieldNow).toBe(1)
  })

  /*
   * Luck is wins minus all-play expected wins — both counts of wins, so it is comparable across
   * leagues where points-for is not.
   */
  it('names the luckiest and most robbed records only past a full win', () => {
    const p = buildStandingsPortfolio(
      outlook([
        league('lucky', { wins: 3, losses: 0, expectedWins: 1.4 }),
        league('robbed', { wins: 0, losses: 3, expectedWins: 2.2, seed: 11 }),
        league('fair', { wins: 2, losses: 1, expectedWins: 1.8, seed: 4 }),
      ]),
    )
    const keys = p.spotlights.map((s) => s.key)
    expect(keys).toContain('lucky')
    expect(keys).toContain('robbed')
    expect(p.spotlights.find((s) => s.key === 'lucky')?.league).toBe('League lucky')
    expect(p.rows.find((r) => r.id === 'fair')?.luck).toBeCloseTo(0.2)
  })

  it('leaves luck unknown rather than zero when expected wins are missing', () => {
    const p = buildStandingsPortfolio(outlook([league('a', { expectedWins: null })]))
    expect(p.rows[0].luck).toBeNull()
    expect(p.spotlights.some((s) => s.key === 'lucky' || s.key === 'robbed')).toBe(false)
  })
})

describe('groupWithheld', () => {
  it('groups by reason, largest group first, keeping every league', () => {
    const g = groupWithheld([
      { leagueName: 'X', reason: 'r2' },
      { leagueName: 'A', reason: 'r1' },
      { leagueName: 'B', reason: 'r1' },
    ])
    expect(g).toEqual([
      { reason: 'r1', leagues: ['A', 'B'] },
      { reason: 'r2', leagues: ['X'] },
    ])
  })
})
