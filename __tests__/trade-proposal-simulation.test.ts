import { describe, expect, it } from 'vitest'
import { enrichProposalSimulations, hasPairedProposalSimulation } from '@/lib/league-trade-engine/proposalSimulation'
import type { SuggestionRoster, TradePartnerSuggestion } from '@/lib/league-trade-engine/proposalSuggestions'

describe('trade proposal counterfactual simulation', () => {
  it('adds a before/after playoff probability to a proposed package', () => {
    const roster = (id: string, projection: number): SuggestionRoster => ({
      rosterId: id, ownerName: id, wins: 0, losses: 0, faabRemaining: 100, picks: [],
      players: Array.from({ length: 6 }, (_, index) => ({ id: `${id}-${index}`, name: `${id}-${index}`, position: index < 2 ? 'RB' : 'WR', value: projection * 100, weeklyProjection: projection })),
    })
    const rosters = [roster('mine', 8), roster('partner', 14), roster('other', 10), roster('fourth', 11)]
    const suggestions: TradePartnerSuggestion[] = [{
      rosterId: 'partner', fitScore: 80, reasons: [], packages: [{
        id: 'p', send: [{ kind: 'player', id: 'mine-0', name: 'mine-0', value: 800, position: 'RB', amount: null, itemType: 'player' }],
        receive: [{ kind: 'player', id: 'partner-0', name: 'partner-0', value: 1400, position: 'RB', amount: null, itemType: 'player' }],
        sendValue: 800, receiveValue: 1400, fairness: 75, acceptanceLikelihood: null, reason: 'upgrade',
      }],
    }]
    const [result] = enrichProposalSimulations({ suggestions, rosters, viewerRosterId: 'mine', leagueMode: 'redraft', weeksRemaining: 8, playoffTeams: 2, iterations: 80 })
    expect(result?.packages[0]?.simulation?.available).toBe(true)
    expect(result?.packages[0]?.simulation?.metric).toBe('playoff')
    expect(result?.packages[0]?.simulation?.deltaPct).not.toBeNull()
    expect(hasPairedProposalSimulation({ suggestions: [result!], multiTeamSuggestions: [] })).toBe(true)
  })

  it('keeps contextual readiness false when a paired simulation is unavailable', () => {
    const suggestion = {
      rosterId: 'partner', fitScore: 50, reasons: [], packages: [{
        id: 'p', send: [], receive: [], sendValue: 0, receiveValue: 0, fairness: 0,
        acceptanceLikelihood: null, reason: 'insufficient evidence',
        simulation: { available: false, metric: 'playoff' as const, beforePct: null, afterPct: null, deltaPct: null, iterations: 0, reason: 'missing projections' },
      }],
    }
    expect(hasPairedProposalSimulation({ suggestions: [suggestion], multiTeamSuggestions: [] })).toBe(false)
  })
})
