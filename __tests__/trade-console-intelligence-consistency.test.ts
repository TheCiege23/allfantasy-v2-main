import { describe, expect, it } from 'vitest'
import { buildTradeIntelligence } from '@/lib/trade-value-console/build-trade-intelligence'

const input: Parameters<typeof buildTradeIntelligence>[0] = {
  league: null, strategy: 'neutral', teamContext: 'my_team', fairnessLabel: 'Major overpay',
  sideAdvantage: 'opponent', percentDiff: -30, giveTotal: 1000, getTotal: 700,
  confidenceScore: 70, degraded: false, dataGaps: [], injuryNotes: [], drivers: {},
  negotiationToolkit: null, rosterSummary: { lineupSimulation: false, yourRosterPlayers: 0, theirRosterPlayers: 0 },
  leagueHistoryNote: null,
  projectedImpact: { giveTotal: null, getTotal: null, net: null, summary: 'Unavailable' },
}

describe('trade commentary and counter targets', () => {
  it('keeps a priced league verdict when context is incomplete and omits the conflicting driver verdict', () => {
    const result = buildTradeIntelligence({ ...input, degraded: true, proposalGraded: true,
      drivers: { verdict: 'Strong Win' }, dataGaps: ['Missing roster context'] })
    expect(result.whoWinsLongTerm).toBe('opponent')
    expect(result.why).not.toContain('Engine verdict: Strong Win')
    expect(buildTradeIntelligence({ ...input, strategy: 'rebuilder', drivers: { verdict: 'Strong Win' } }).rebuilderRecommendation).not.toContain('Strong Win')
    expect(buildTradeIntelligence({ ...input, proposalGraded: false }).whoWinsLongTerm).toBe('unknown')
  })
  it('does not turn absent projections into a production winner or invent a second dynasty grade band', () => {
    const result = buildTradeIntelligence({ ...input, percentDiff: 9, sideAdvantage: 'even',
      league: { isDynasty: true, name: 'Dynasty', quickModeBadges: [] } as never })
    expect(result.whoWinsNow).toBe('unknown')
    expect(result.whoWinsLongTerm).toBe('even')
    expect(result.contenderRecommendation).toContain('weekly production is unavailable')
  })
  it('finds the closest balancing asset instead of recommending their best player', () => {
    const result = buildTradeIntelligence({ ...input, opponentRosterTargets: [
      { name: 'Star', position: 'WR', marketValue: 9000 },
      { name: 'Depth', position: 'RB', marketValue: 290 },
      { name: 'Missing', position: 'LB', marketValue: 0 },
    ] })
    expect(result.alternateTargets[0].name).toBe('Depth')
    expect(result.alternateTargets).toHaveLength(2)
    expect(result.rebalanceSuggestions[0]).toContain('Ask for Depth')
    expect(result.rebalanceSuggestions.join(' ')).not.toContain('Ask for Star')
    expect(result.fairnessVerdict).toContain('League value delta -30%')
    expect(result.fairnessVerdict).not.toContain('composite-based')
  })
  it('does not claim a balancing counter with incomplete pricing', () => {
    const result = buildTradeIntelligence({ ...input, degraded: true,
      opponentRosterTargets: [{ name: 'Depth', position: 'RB', marketValue: 300 }],
    })
    expect(result.rebalanceSuggestions).toEqual([])
  })
})
