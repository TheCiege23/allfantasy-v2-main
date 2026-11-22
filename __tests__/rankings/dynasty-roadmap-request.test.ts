import { describe, expect, it } from 'vitest'

import { buildDynastyRoadmapRequest } from '@/lib/rankings-engine/dynastyRoadmapRequest'

const TEAM = {
  composite: 64,
  totalRosterValue: 6200,
  positionValues: {
    QB: { total: 1100 },
    RB: { total: 1900 },
    WR: { total: 2600 },
    TE: { total: 600 },
  },
  rosterExposure: { QB: 18, RB: 30, WR: 42, TE: 10 },
}

describe('buildDynastyRoadmapRequest', () => {
  it('scores each position group against the strongest and names the weak ones', () => {
    const body = buildDynastyRoadmapRequest(TEAM, { sport: 'NFL', isDynasty: true, isSuperFlex: true, leagueName: 'L' })

    expect(body.positionStrengths).toEqual({ QB: 42, RB: 73, WR: 100, TE: 23 })
    expect(body.weakPositions).toEqual(['TE'])
    expect(body.topAssets).toEqual(['WR group (42% exposure)', 'RB group (30% exposure)', 'QB group (18% exposure)'])
    expect(body).toMatchObject({ sport: 'NFL', leagueType: 'Dynasty', isSF: true, goal: 'compete', totalValue: 6200, leagueName: 'L' })
    // The groups keep their league-v2 order; only topAssets is sorted.
    expect(body.rosterSignals.map((r) => r.position)).toEqual(['QB', 'RB', 'WR', 'TE'])
  })

  it('asks for a rebuild below a 60 composite and fills in what an older row lacks', () => {
    const body = buildDynastyRoadmapRequest({ composite: 59 }, {})

    expect(body).toMatchObject({ leagueType: 'Redraft', isSF: false, goal: 'rebuild', totalValue: 0, rosterSignals: [], weakPositions: [] })
    expect(body).not.toHaveProperty('sport')
    expect(body).not.toHaveProperty('leagueName')
    // The default projection falls off, which reads as an older roster.
    expect(body.avgAge).toBe(30)
  })
})
