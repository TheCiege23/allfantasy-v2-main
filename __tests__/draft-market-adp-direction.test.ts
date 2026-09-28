import { describe, expect, it } from 'vitest'
import { computeDraftDecision, type DraftAvailablePlayer, type DraftDecisionInput } from '@/lib/draft-intelligence/draft-decision-engine'
import { identifyFades, identifyValuePlayers } from '@/lib/draft-intelligence/draft-board-analyzer'
import { runDraftWarRoom, WarRoomInputSchema } from '@/lib/draft-war-room/draft-war-room-engine'

const player = (name: string, adp: number, position = 'WR'): DraftAvailablePlayer => ({
  playerId: name, name, adp, position, team: null, value: 3000, age: null, tier: null,
})

const positions = { NFL: 'WR', NBA: 'PG', NHL: 'C', MLB: 'OF', NCAAF: 'WR', NCAAB: 'PG', SOCCER: 'MID' }
for (const [sport, position] of Object.entries(positions)) {
  describe(`${sport} market ADP direction`, () => {
    const availablePlayers = [player('Early market pick', 10, position), player('Late market pick', 50, position)]
    const input: DraftDecisionInput = {
      draftType: 'snake', sport, leagueFormat: 'redraft', scoringType: 'points', isSF: false, isTEP: false,
      numTeams: 4, currentPick: 30, currentRound: 8, totalRounds: 15, myTeamId: 'my-team',
      myRoster: [], availablePlayers, draftedByOthers: [], rosterRequirements: { [position]: 1 }, strategy: 'value', mode: 'live',
    }
    it('prefers a player still available after their usual pick over an otherwise identical reach', () => {
      const result = computeDraftDecision(input)
      expect(result.recommendedPick.playerName).toBe('Early market pick')
      expect(result.recommendedPick.isValue).toBe(true)
      expect(result.recommendedPick.isReach).toBe(false)
      expect(result.recommendedPick.boardValueScore).toBeGreaterThan(result.topAlternatives[0].boardValueScore)
      expect(result.topAlternatives[0].isReach).toBe(true)
      expect(result.recommendedPick.reasoning).toContain('ADP 10 vs pick 30 — strong value')
      expect(result.draftPlanNote).toContain('available after their usual draft position')
    })
    it('identifies bargains and reaches consistently with the recommendation', () => {
      expect(identifyValuePlayers(availablePlayers, 30).map(p => p.name)).toEqual(['Early market pick'])
      expect(identifyFades(availablePlayers, 30).map(p => p.name)).toEqual(['Late market pick'])
    })
    it('reports positive picks of market discount in the War Room', () => {
      const result = runDraftWarRoom(WarRoomInputSchema.parse({
        sport, currentPickNumber: 30, currentRound: 8, myTeamId: 'my-team', availablePlayers,
        rosterRequirements: { [position]: 1 }, strategyGoal: 'value',
      }))
      expect(result.bestPick.playerName).toBe('Early market pick')
      expect(result.bestPick.valueLabel).toBe('VALUE')
      expect(result.valueOnBoardNotes).toEqual([`Early market pick (${position}): ADP 10 — available 20 picks after expected`])
    })
  })
}

it('orders bargains by how far they have fallen, with no value/reach signal at ADP', () => {
  const available = [player('Small discount', 20), player('Large discount', 10), player('At market', 30)]
  expect(identifyValuePlayers(available, 30).map(p => p.name)).toEqual(['Large discount', 'Small discount'])
  expect(identifyFades([player('At market', 30)], 30)).toEqual([])
})
