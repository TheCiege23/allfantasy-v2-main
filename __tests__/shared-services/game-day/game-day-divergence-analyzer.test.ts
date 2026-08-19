import { describe, expect, it } from 'vitest'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { LeagueGameDayContext, LineupAttentionItem } from '@/lib/shared-services/game-day/types'
import { analyzeGameDayDivergence } from '@/lib/shared-services/game-day/GameDayDivergenceAnalyzer'

function makeLegacyAction(overrides: Partial<LineupActionItem> = {}): LineupActionItem {
  return {
    leagueId: 'league-1',
    leagueName: 'L1',
    sport: 'NFL' as any,
    platform: 'sleeper',
    teamId: 'roster-1',
    slotIndex: null,
    slotId: null,
    slotLabel: null,
    playerId: 'p1',
    playerName: 'Player One',
    reasonType: 'injured_starter',
    urgency: 'urgent',
    lockTime: null,
    recommendedAction: null,
    suggestedReplacementPlayerId: null,
    confidence: 80,
    expectedGain: null,
    sourceModule: 'lineup_scan',
    message: 'Player One is Out',
    severity: 'critical',
    ...overrides,
  }
}

function makeNewItem(overrides: Partial<LineupAttentionItem> = {}): LineupAttentionItem {
  return {
    reasonCode: 'starter_ruled_out',
    severity: 'critical',
    message: 'x',
    leagueId: 'league-1',
    leagueName: null,
    rosterId: 'roster-1',
    playerId: 'p1',
    playerName: 'Player One',
    evidence: [],
    freshness: 'fresh',
    sourceAttribution: { source: 'x', fetchedAt: new Date().toISOString(), providerTimestamp: null, freshness: 'fresh', confidence: 90, missingDataReason: null },
    confidence: 90,
    risk: 'high',
    actionable: true,
    providerDeepLink: null,
    ...overrides,
  }
}

function makeMinimalContext(leagueId: string): LeagueGameDayContext {
  return { leagueId } as unknown as LeagueGameDayContext
}

describe('analyzeGameDayDivergence', () => {
  it('reports no divergence when both sources agree on the same player and severity', () => {
    const result = analyzeGameDayDivergence({
      leagueContexts: [makeMinimalContext('league-1')],
      newAttentionItems: [makeNewItem()],
      legacyActions: [makeLegacyAction()],
    })
    expect(result).toEqual([])
  })

  it('flags a missing_league when the legacy engine reports a league the context assembler never saw', () => {
    const result = analyzeGameDayDivergence({
      leagueContexts: [makeMinimalContext('league-1')],
      newAttentionItems: [],
      legacyActions: [makeLegacyAction({ leagueId: 'league-2' })],
    })
    expect(result).toContainEqual({
      category: 'missing_league',
      leagueId: 'league-2',
      playerId: null,
      primaryValue: 'not_assembled',
      legacyValue: 'present',
      notes: expect.any(Array),
    })
  })

  it('flags status_mismatch when the legacy engine detects an injury issue this service does not', () => {
    const result = analyzeGameDayDivergence({
      leagueContexts: [makeMinimalContext('league-1')],
      newAttentionItems: [],
      legacyActions: [makeLegacyAction()],
    })
    expect(result.some((d) => d.category === 'status_mismatch' && d.legacyValue === 'injured_starter' && d.primaryValue === null)).toBe(true)
  })

  it('flags status_mismatch when this service detects an injury issue the legacy engine does not', () => {
    const result = analyzeGameDayDivergence({
      leagueContexts: [makeMinimalContext('league-1')],
      newAttentionItems: [makeNewItem()],
      legacyActions: [],
    })
    expect(result.some((d) => d.category === 'status_mismatch' && d.primaryValue === 'starter_ruled_out' && d.legacyValue === null)).toBe(true)
  })

  it('flags alert_severity_mismatch when both sources agree on the player but disagree on severity', () => {
    const result = analyzeGameDayDivergence({
      leagueContexts: [makeMinimalContext('league-1')],
      newAttentionItems: [makeNewItem({ severity: 'info' })],
      legacyActions: [makeLegacyAction({ severity: 'critical' })],
    })
    expect(result).toEqual([
      { category: 'alert_severity_mismatch', leagueId: 'league-1', playerId: 'p1', primaryValue: 'info', legacyValue: 'critical', notes: expect.any(Array) },
    ])
  })

  it('handles empty inputs cleanly', () => {
    expect(analyzeGameDayDivergence({ leagueContexts: [], newAttentionItems: [], legacyActions: [] })).toEqual([])
  })
})
