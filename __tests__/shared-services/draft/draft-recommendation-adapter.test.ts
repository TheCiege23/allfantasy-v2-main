import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'

const { mockDecideDraftPickWithScores, mockGetBotProfileByArchetype } = vi.hoisted(() => ({
  mockDecideDraftPickWithScores: vi.fn(),
  mockGetBotProfileByArchetype: vi.fn(),
}))

vi.mock('@/lib/ai/opponents/draft/aiOpponentDraft', () => ({ decideDraftPickWithScores: mockDecideDraftPickWithScores }))
vi.mock('@/lib/ai/opponents/botProfiles', () => ({ getBotProfileByArchetype: mockGetBotProfileByArchetype }))

import { runLegacyDraftGrader } from '@/lib/shared-services/draft/DraftRecommendationAdapter'

const BALANCED_BOT = {
  botId: 'bot-1',
  displayName: 'Balanced Builder',
  avatarUrl: null,
  archetypeId: 'balanced_builder' as const,
  description: 'Steady ADP with light roster-awareness.',
  tendencies: { winNowVsFuture: 0, riskTolerance: 0.5, tradeAggression: 0.45, waiverAggression: 0.45, rookieAppetite: 0.4, positionalPremiumBias: {}, zeroRbWeight: 0, heroRbWeight: 0, qbEarlyWeight: 0, tePremiumWeight: 0, chaosReach: 0.1, devyWeight: 0, pickHoarding: 0.2, vetBuyerWeight: 0.2, floorVsUpside: 0.5, bluffTendency: 0.15 },
  activityLevel: 1,
}

function makeContext(overrides: Partial<DraftDecisionContext> = {}): DraftDecisionContext {
  return {
    leagueId: 'league-1',
    rosterId: 'roster-1',
    sessionId: 'session-1',
    platform: 'sleeper',
    sport: 'NFL',
    isDynasty: false,
    isSF: false,
    round: 3,
    pick: 30,
    totalTeams: 12,
    status: 'in_progress',
    draftType: 'snake',
    isDevy: false,
    managerKey: 'manager-1',
    assembledAt: new Date().toISOString(),
    engineInput: {
      available: [{ name: 'Player One', position: 'RB', team: 'KC', adp: 25, byeWeek: null }],
      teamRoster: [{ position: 'QB', team: 'BUF', byeWeek: null }],
      rosterSlots: ['QB', 'RB', 'WR'],
      round: 3,
      pick: 30,
      totalTeams: 12,
      sport: 'NFL',
      isDynasty: false,
      isSF: false,
      mode: 'needs',
    },
    playerIdByKey: new Map([['player one|rb', 'p1']]),
    dataCompleteness: { availablePoolSize: 1, adpSampleTotal: 40, rosterPickCount: 1, unresolvedPlayerIdCount: 0 },
    ...overrides,
  }
}

describe('runLegacyDraftGrader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBotProfileByArchetype.mockReturnValue(BALANCED_BOT)
  })

  it('maps a real decideDraftPickWithScores result into a LegacyDraftGraderResult', async () => {
    mockDecideDraftPickWithScores.mockReturnValue({
      decision: { playerId: 'p1', reason: 'Value + roster fit', confidence: 0.72 },
      candidateScores: [{ playerId: 'p1', score: 50 }],
    })

    const result = await runLegacyDraftGrader(makeContext())

    expect(mockGetBotProfileByArchetype).toHaveBeenCalledWith('balanced_builder')
    expect(mockDecideDraftPickWithScores).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', teamId: 'roster-1', bot: BALANCED_BOT, format: 'snake', round: 3, overallPick: 30 })
    )
    expect(result).toEqual({
      graderId: 'ai_opponent_draft',
      topPlayerId: 'p1',
      topPlayerName: 'Player One',
      confidence: 0.72,
      reason: 'Value + roster fit',
      error: null,
    })
  })

  it('maps unrecognized draftType to the "unknown" format hint honestly', async () => {
    mockDecideDraftPickWithScores.mockReturnValue({ decision: { playerId: 'p1', reason: 'x', confidence: 0.5 }, candidateScores: [] })
    await runLegacyDraftGrader(makeContext({ draftType: 'something_new' }))
    expect(mockDecideDraftPickWithScores).toHaveBeenCalledWith(expect.objectContaining({ format: 'unknown' }))
  })

  it('reports an honest error when no available players exist', async () => {
    const result = await runLegacyDraftGrader(
      makeContext({ engineInput: { available: [], teamRoster: [], rosterSlots: [], round: 3, pick: 30, totalTeams: 12, sport: 'NFL', isDynasty: false, isSF: false, mode: 'needs' } })
    )
    expect(result.error).toBe('No available players in the assembled context.')
    expect(mockDecideDraftPickWithScores).not.toHaveBeenCalled()
  })

  it('never throws — a legacy engine failure is caught and reported as an error, not propagated', async () => {
    mockDecideDraftPickWithScores.mockImplementation(() => {
      throw new Error('decideDraftPick: no available players')
    })
    const result = await runLegacyDraftGrader(makeContext())
    expect(result.error).toBe('decideDraftPick: no available players')
    expect(result.topPlayerId).toBeNull()
  })

  it('reports an honest error if the balanced_builder archetype is missing', async () => {
    mockGetBotProfileByArchetype.mockReturnValue(null)
    const result = await runLegacyDraftGrader(makeContext())
    expect(result.error).toBe('balanced_builder archetype not found')
  })
})
