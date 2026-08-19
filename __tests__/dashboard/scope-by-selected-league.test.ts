import { describe, expect, it } from 'vitest'
import { scopeBySelectedLeague } from '@/lib/dashboard/scope-by-selected-league'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { PendingTradeLeague } from '@/app/dashboard/dashboardStripApiTypes'

function action(overrides: Partial<LineupActionItem>): LineupActionItem {
  return {
    leagueId: 'league-a',
    leagueName: 'League A',
    sport: 'NFL',
    platform: 'sleeper',
    teamId: null,
    slotIndex: null,
    slotId: null,
    slotLabel: null,
    playerId: null,
    playerName: null,
    reasonType: 'empty_starter',
    urgency: 'urgent',
    lockTime: null,
    recommendedAction: null,
    suggestedReplacementPlayerId: null,
    confidence: null,
    expectedGain: null,
    sourceModule: 'lineup_scan',
    message: 'test',
    severity: 'critical',
    ...overrides,
  }
}

function tradeLeague(overrides: Partial<PendingTradeLeague>): PendingTradeLeague {
  return {
    leagueId: 'league-a',
    leagueName: 'League A',
    leagueAvatar: null,
    sport: 'NFL',
    trades: [],
    ...overrides,
  }
}

describe('scopeBySelectedLeague', () => {
  describe('lineup actions (D7: Recommendations, Today\'s Agenda, hero urgent count)', () => {
    const actions = [action({ leagueId: 'league-a' }), action({ leagueId: 'league-b' })]

    it('returns every action when no league is selected (Global Command Center)', () => {
      expect(scopeBySelectedLeague(actions, null)).toEqual(actions)
    })

    it('excludes another league\'s actions when a league is selected', () => {
      const scoped = scopeBySelectedLeague(actions, 'league-b')
      expect(scoped).toHaveLength(1)
      expect(scoped[0].leagueId).toBe('league-b')
    })

    it('returns an empty list when the selected league has no actions', () => {
      expect(scopeBySelectedLeague(actions, 'league-c')).toEqual([])
    })
  })

  describe('pending trade leagues (Weekly Game Plan)', () => {
    const tradeLeagues = [tradeLeague({ leagueId: 'league-a' }), tradeLeague({ leagueId: 'league-b' })]

    it('returns every league\'s trades when no league is selected', () => {
      expect(scopeBySelectedLeague(tradeLeagues, null)).toEqual(tradeLeagues)
    })

    it('excludes another league\'s trades when a league is selected', () => {
      const scoped = scopeBySelectedLeague(tradeLeagues, 'league-a')
      expect(scoped).toHaveLength(1)
      expect(scoped[0].leagueId).toBe('league-a')
    })
  })
})
