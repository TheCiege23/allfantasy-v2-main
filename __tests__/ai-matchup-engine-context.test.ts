import { describe, expect, it } from 'vitest'
import { compactMatchupForAi } from '@/lib/ai-matchup-engine/context'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

const minimalPayload = (): MatchupCenterPayload => ({
  leagueId: 'l1',
  season: 2026,
  week: 5,
  sport: 'NBA',
  matchupStatus: 'live',
  conceptOverlay: null,
  refreshIntervalMs: 30000,
  left: {
    rosterId: 'a',
    teamName: 'A',
    avatarUrl: null,
    record: { wins: 2, losses: 1, ties: 0 },
    winPct: 0.66,
    totalPoints: 90,
    projectedTotal: 102,
    projectedTotalIncludesFallback: false,
    remainingStarters: 3,
    starters: [
      {
        playerId: 'p1',
        name: 'Star',
        position: 'PG',
        team: 'BOS',
        opponent: 'NYK',
        headshotUrl: null,
        currentPoints: 22,
        projectedPoints: 28,
        hasRealProjection: true,
        injuryStatus: null,
        newsBlurb: 'x'.repeat(300),
        weatherSummary: null,
        gameStatus: 'live',
        gameLabel: 'Scoring',
        aiInsight: null,
      },
    ],
  },
  right: {
    rosterId: 'b',
    teamName: 'B',
    avatarUrl: null,
    record: { wins: 1, losses: 2, ties: 0 },
    winPct: 0.33,
    totalPoints: 88,
    projectedTotal: 99,
    projectedTotalIncludesFallback: false,
    remainingStarters: 4,
    starters: [],
  },
  winProbabilityLeft: 0.52,
  insights: {
    matchupEdge: 'e',
    startSit: 's',
    weather: 'w',
    injuryNews: 'i',
    swingPlayers: ['a'],
    riskLevel: 'medium',
    floorVsCeiling: 'f',
  },
  partialData: false,
})

describe('ai matchup engine context', () => {
  it('compactMatchupForAi trims news and preserves sport', () => {
    const c = compactMatchupForAi(minimalPayload())
    expect(c.sport).toBe('NBA')
    const starters = (c.left as { starters: Array<{ newsBlurb: string | null }> }).starters
    expect(starters[0]?.newsBlurb?.length).toBeLessThanOrEqual(200)
  })
})
