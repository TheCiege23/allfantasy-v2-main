import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueGameDayContext } from '@/lib/shared-services/game-day/types'

const { mockComputeLineupActionsForUser, mockFantasyScheduleGameFindFirst } = vi.hoisted(() => ({
  mockComputeLineupActionsForUser: vi.fn(),
  mockFantasyScheduleGameFindFirst: vi.fn(),
}))

vi.mock('@/lib/lineup-actions/computeLineupActionsForUser', () => ({ computeLineupActionsForUser: mockComputeLineupActionsForUser }))
vi.mock('@/lib/prisma', () => ({ prisma: { fantasyScheduleGame: { findFirst: mockFantasyScheduleGameFindFirst } } }))

import { computeLineupAttention } from '@/lib/shared-services/game-day/LineupAttentionService'

function makeStarter(overrides: Partial<{ playerId: string; name: string; position: string; team: string | null; injuryStatus: string | null; gameStatus: 'upcoming' | 'live' | 'final' | 'unknown'; currentPoints: number; projectedPoints: number }> = {}) {
  return {
    playerId: 'p1',
    name: 'Player One',
    position: 'RB',
    team: 'KC',
    opponent: null,
    headshotUrl: null,
    currentPoints: 0,
    projectedPoints: 12,
    injuryStatus: null,
    newsBlurb: null,
    weatherSummary: null,
    gameStatus: 'upcoming' as const,
    gameLabel: 'Scheduled',
    aiInsight: null,
    ...overrides,
  }
}

function makeContext(starters: ReturnType<typeof makeStarter>[], overrides: Partial<LeagueGameDayContext> = {}): LeagueGameDayContext {
  return {
    leagueId: 'league-1',
    season: 2026,
    week: 5,
    sport: 'NFL',
    platform: 'sleeper',
    weekResolution: { source: 'redraftSeason', isPlayoffWeek: false, playoffStartWeek: null },
    matchup: {
      leagueId: 'league-1',
      season: 2026,
      week: 5,
      sport: 'NFL',
      matchupStatus: 'upcoming',
      conceptOverlay: null,
      left: { rosterId: 'roster-1', teamName: 'My Team', avatarUrl: null, record: { wins: 3, losses: 2, ties: 0 }, winPct: 0.6, totalPoints: 0, projectedTotal: 0, starters, remainingStarters: starters.length },
      right: { rosterId: 'roster-2', teamName: 'Opp', avatarUrl: null, record: { wins: 2, losses: 3, ties: 0 }, winPct: 0.4, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0 },
      winProbabilityLeft: 0.5,
      insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
      partialData: false,
      refreshIntervalMs: 30000,
    },
    matchupState: { state: 'upcoming', attribution: { source: 'matchup-center-service', fetchedAt: new Date().toISOString(), providerTimestamp: null, freshness: 'fresh', confidence: 90, missingDataReason: null } },
    unavailableReason: null,
    ...overrides,
  }
}

describe('computeLineupAttention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComputeLineupActionsForUser.mockResolvedValue({ actions: [] })
    mockFantasyScheduleGameFindFirst.mockResolvedValue(null)
  })

  it('maps a real legacy action into a LineupAttentionItem and drops fetch_error (matching the source engine\'s own convention)', async () => {
    mockComputeLineupActionsForUser.mockResolvedValue({
      actions: [
        { leagueId: 'league-2', leagueName: 'L2', sport: 'NFL', platform: 'sleeper', teamId: 'roster-x', slotIndex: 1, slotId: null, slotLabel: 'RB', playerId: null, playerName: null, reasonType: 'empty_starter', urgency: 'urgent', lockTime: null, recommendedAction: null, suggestedReplacementPlayerId: null, confidence: 90, expectedGain: null, sourceModule: 'lineup_scan', message: 'Empty RB slot', severity: 'critical' },
        { leagueId: 'league-2', leagueName: 'L2', sport: 'NFL', platform: 'sleeper', teamId: 'roster-x', slotIndex: null, slotId: null, slotLabel: null, playerId: null, playerName: null, reasonType: 'fetch_error', urgency: 'low', lockTime: null, recommendedAction: null, suggestedReplacementPlayerId: null, confidence: null, expectedGain: null, sourceModule: 'lineup_scan', message: 'Fetch failed', severity: 'info' },
      ],
    })

    const { items, legacyActions } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [] })

    expect(items).toHaveLength(1)
    expect(items[0].reasonCode).toBe('empty_starting_slot')
    expect(legacyActions).toHaveLength(2)
  })

  it('detects a ruled-out starter from real injuryStatus and flags it actionable when the game has not started', async () => {
    const ctx = makeContext([makeStarter({ injuryStatus: 'Out', gameStatus: 'upcoming' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })

    const item = items.find((i) => i.reasonCode === 'starter_ruled_out')
    expect(item).toBeDefined()
    expect(item?.severity).toBe('critical')
    expect(item?.actionable).toBe(true)
  })

  it('downgrades severity and marks non-actionable when the ruled-out starter\'s game already locked', async () => {
    const ctx = makeContext([makeStarter({ injuryStatus: 'Out', gameStatus: 'live' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })

    const item = items.find((i) => i.reasonCode === 'starter_ruled_out')
    expect(item?.severity).toBe('info')
    expect(item?.actionable).toBe(false)
  })

  it('detects a questionable/doubtful starter distinctly from a ruled-out one', async () => {
    const ctx = makeContext([makeStarter({ injuryStatus: 'Questionable', gameStatus: 'upcoming' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })

    expect(items.some((i) => i.reasonCode === 'starter_questionable_or_doubtful')).toBe(true)
    expect(items.some((i) => i.reasonCode === 'starter_ruled_out')).toBe(false)
  })

  it('flags a stale player status item when the league context itself is stale', async () => {
    const ctx = makeContext([makeStarter()], {
      matchupState: { state: 'stale', attribution: { source: 'matchup-center-service', fetchedAt: new Date().toISOString(), providerTimestamp: null, freshness: 'stale', confidence: 30, missingDataReason: 'old fetch' } },
    })
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })
    expect(items.some((i) => i.reasonCode === 'stale_player_status')).toBe(true)
  })

  it('flags a missing projection for an upcoming starter with zero points and zero projection', async () => {
    const ctx = makeContext([makeStarter({ projectedPoints: 0, currentPoints: 0, gameStatus: 'upcoming' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })
    expect(items.some((i) => i.reasonCode === 'missing_projection')).toBe(true)
  })

  it('flags a postponed/cancelled game via a real FantasyScheduleGame status cross-reference', async () => {
    mockFantasyScheduleGameFindFirst.mockResolvedValue({ status: 'postponed' })
    const ctx = makeContext([makeStarter({ gameStatus: 'upcoming' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })
    expect(items.some((i) => i.reasonCode === 'starter_game_postponed_or_cancelled')).toBe(true)
  })

  it('does not flag postponement for a starter whose game already locked', async () => {
    mockFantasyScheduleGameFindFirst.mockResolvedValue({ status: 'postponed' })
    const ctx = makeContext([makeStarter({ gameStatus: 'live' })])
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })
    expect(items.some((i) => i.reasonCode === 'starter_game_postponed_or_cancelled')).toBe(false)
  })

  it('skips a league context with no matchup entirely', async () => {
    const ctx = makeContext([], { matchup: null, unavailableReason: 'League not found.' })
    const { items } = await computeLineupAttention({ userId: 'user-1', leagueContexts: [ctx] })
    expect(items).toEqual([])
  })
})
