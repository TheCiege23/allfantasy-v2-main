import { describe, it, expect } from 'vitest'
import {
  deriveAnalytics, derivePositionStrength, deriveScoring, positionTone,
  type LeagueRankingsResponse, type TeamScoreLite,
} from '@/components/dashboard/adaptive/hooks/deriveAnalytics'
import {
  areaPath, columnHeights, poly, radarPoints, ring,
} from '@/components/dashboard/adaptive/charts/chart-geometry'

/**
 * The adaptive dashboard's charts render whatever these functions return, so this is where
 * "the dashboard shows real numbers" is actually enforced.
 *
 * The emphasis is deliberately on ABSENCE: this dashboard's stated contract is that a metric
 * with no data reaches the UI as `null` so the card can say so, rather than as a zero that
 * renders as a real-looking result. Fabricated dashboard data has been a recurring,
 * separately-fixed bug class in this repo, so each "returns null" case below is a guard
 * against reintroducing it.
 */

function team(over: Partial<TeamScoreLite> & { rosterId: number; ownerId: string }): TeamScoreLite {
  return {
    username: null,
    displayName: null,
    rank: 1,
    prevRank: null,
    rankDelta: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pointsFor: 0,
    positionValues: {},
    forwardOdds: { playoffPct: 0, top3Pct: 0, titlePct: 0, simCount: 0 },
    rankSparkline: [],
    ...over,
  }
}

const RESPONSE: LeagueRankingsResponse = {
  leagueId: 'lg1',
  leagueName: 'Test League',
  week: 5,
  teams: [
    team({
      rosterId: 1, ownerId: 'me', displayName: 'My Team', rank: 2, rankDelta: 1,
      record: { wins: 3, losses: 2, ties: 0 }, pointsFor: 500,
      positionValues: { QB: { starter: 0, bench: 0, total: 120 }, RB: { starter: 0, bench: 0, total: 60 } },
      forwardOdds: { playoffPct: 71.4, top3Pct: 40, titlePct: 12.5, simCount: 1000 },
      rankSparkline: [4, 3, 3, 2, 2],
    }),
    team({
      rosterId: 2, ownerId: 'other', displayName: 'Rival', rank: 1, rankDelta: -1,
      record: { wins: 4, losses: 1, ties: 0 },
      positionValues: { QB: { starter: 0, bench: 0, total: 80 }, RB: { starter: 0, bench: 0, total: 140 } },
    }),
  ],
  weeklyPointsDistribution: [
    { rosterId: 1, weeklyPoints: [100, 110, 90, 120, 130] },
    { rosterId: 2, weeklyPoints: [80, 90, 100, 110, 120] },
  ],
}

describe('deriveAnalytics — identifying the viewer', () => {
  it('resolves the viewer team by platform owner id', () => {
    const a = deriveAnalytics(RESPONSE, 'me')
    expect(a.me).not.toBeNull()
    expect(a.me!.rank).toBe(2)
    expect(a.me!.totalTeams).toBe(2)
    expect(a.me!.record).toEqual({ wins: 3, losses: 2, ties: 0 })
    expect(a.me!.playoffPct).toBeCloseTo(71.4)
    expect(a.me!.titlePct).toBeCloseTo(12.5)
    expect(a.me!.simCount).toBe(1000)
  })

  it('returns me=null when the viewer is not in this league, rather than defaulting to a team', () => {
    expect(deriveAnalytics(RESPONSE, 'stranger').me).toBeNull()
    expect(deriveAnalytics(RESPONSE, null).me).toBeNull()
  })

  it('orders power rankings by rank and flags the viewer', () => {
    const rows = deriveAnalytics(RESPONSE, 'me').powerRankings
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
    expect(rows.find((r) => r.isMe)!.name).toBe('My Team')
    expect(rows.find((r) => r.isMe)!.record).toBe('3-2')
  })
})

describe('deriveScoring', () => {
  it('returns the viewer series and a per-week league mean', () => {
    const s = deriveScoring(RESPONSE, RESPONSE.teams[0])!
    expect(s.mine).toEqual([100, 110, 90, 120, 130])
    // week 0 mean of 100 and 80
    expect(s.leagueAvg[0]).toBe(90)
    expect(s.leagueAvg[4]).toBe(125)
  })

  it('labels weeks back from the current week', () => {
    expect(deriveScoring(RESPONSE, RESPONSE.teams[0])!.weekLabels).toEqual(['W1', 'W2', 'W3', 'W4', 'W5'])
  })

  it('excludes non-scoring weeks from the mean instead of counting them as zero', () => {
    const withBye: LeagueRankingsResponse = {
      ...RESPONSE,
      weeklyPointsDistribution: [
        { rosterId: 1, weeklyPoints: [100, 110] },
        { rosterId: 2, weeklyPoints: [0, 90] }, // bye in week 1
      ],
    }
    // 100 alone, NOT (100+0)/2 — a bye must not make the user look twice as strong.
    expect(deriveScoring(withBye, RESPONSE.teams[0])!.leagueAvg[0]).toBe(100)
  })

  it('returns null rather than a flat line when there is under a week of history', () => {
    const oneWeek: LeagueRankingsResponse = {
      ...RESPONSE,
      weeklyPointsDistribution: [{ rosterId: 1, weeklyPoints: [100] }],
    }
    expect(deriveScoring(oneWeek, RESPONSE.teams[0])).toBeNull()
    expect(deriveScoring({ ...RESPONSE, weeklyPointsDistribution: [] }, RESPONSE.teams[0])).toBeNull()
  })
})

describe('derivePositionStrength', () => {
  it('indexes each position so 100 is the league average', () => {
    const rows = derivePositionStrength(RESPONSE.teams, RESPONSE.teams[0])!
    const qb = rows.find((r) => r.key === 'QB')!
    const rb = rows.find((r) => r.key === 'RB')!
    // QB: mine 120 vs mean(120,80)=100 → 120
    expect(qb.indexed).toBe(120)
    // RB: mine 60 vs mean(60,140)=100 → 60
    expect(rb.indexed).toBe(60)
  })

  it('caps the index so one runaway position cannot blow out the shared scale', () => {
    const lopsided = [
      team({ rosterId: 1, ownerId: 'me', positionValues: { QB: { starter: 0, bench: 0, total: 10000 } } }),
      team({ rosterId: 2, ownerId: 'o', positionValues: { QB: { starter: 0, bench: 0, total: 1 } } }),
    ]
    expect(derivePositionStrength(lopsided, lopsided[0])![0].indexed).toBe(200)
  })

  it('returns null when there is no comparison to make', () => {
    expect(derivePositionStrength([RESPONSE.teams[0]], RESPONSE.teams[0])).toBeNull()
    expect(derivePositionStrength(RESPONSE.teams, null)).toBeNull()
    const noValues = team({ rosterId: 9, ownerId: 'me', positionValues: {} })
    expect(derivePositionStrength([noValues, RESPONSE.teams[1]], noValues)).toBeNull()
  })

  it('drops positions where the league has no value, instead of indexing against zero', () => {
    const teams = [
      team({ rosterId: 1, ownerId: 'me', positionValues: { QB: { starter: 0, bench: 0, total: 50 }, K: { starter: 0, bench: 0, total: 10 } } }),
      team({ rosterId: 2, ownerId: 'o', positionValues: { QB: { starter: 0, bench: 0, total: 50 }, K: { starter: 0, bench: 0, total: 0 } } }),
    ]
    const rows = derivePositionStrength(teams, teams[0])!
    // K's only other value is 0, so there is no benchmark — the row is omitted, not shown as 0.
    expect(rows.map((r) => r.key)).toEqual(['QB'])
  })
})

describe('positionTone', () => {
  it('maps index bands to the shared accent tokens', () => {
    expect(positionTone(130)).toContain('emerald')
    expect(positionTone(100)).toContain('cyan')
    expect(positionTone(80)).toContain('gold')
    expect(positionTone(50)).toContain('red')
  })
})

describe('chart geometry', () => {
  it('ring clamps percentages instead of drawing past a full sweep', () => {
    const full = ring(40, 100, 1).fg.split(' ')[0]
    expect(ring(40, 150, 1).fg.split(' ')[0]).toBe(full)
    expect(Number(ring(40, -20, 1).fg.split(' ')[0])).toBe(0)
    expect(Number(ring(40, NaN, 1).fg.split(' ')[0])).toBe(0)
  })

  it('poly centres a flat series rather than dividing by zero', () => {
    const pts = poly([5, 5, 5], 100, 50, 0)
    expect(pts).not.toContain('NaN')
    // All three y values equal, at mid-height.
    expect([...new Set(pts.split(' ').map((p) => p.split(',')[1]))]).toEqual(['25.0'])
  })

  it('returns empty output for empty series instead of NaN paths', () => {
    expect(poly([], 100, 50)).toBe('')
    expect(areaPath([], 100, 50)).toBe('')
    expect(columnHeights([], 30)).toEqual([])
    expect(radarPoints([], 100, 50, 50, 40)).toBe('')
  })

  it('columnHeights renders an all-zero series at the floor, not as a divide-by-zero', () => {
    // Nobody traded this week is real data, and must not become NaN-height bars.
    expect(columnHeights([0, 0, 0], 28, 4)).toEqual([4, 4, 4])
  })

  it('areaPath closes the path back to the baseline', () => {
    const d = areaPath([1, 2, 3], 100, 50, 0)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })
})
