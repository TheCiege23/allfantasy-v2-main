import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedraftWarRoomContext } from '@/lib/redraft-war-room/types'

const mocks = vi.hoisted(() => ({
  seasonFindFirst: vi.fn(),
  waiverClaimFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
  proposalFindMany: vi.fn(),
  integritySettingsFindUnique: vi.fn(),
  integrityFlagCount: vi.fn(),
  buildContext: vi.fn(),
  detectCollusion: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: mocks.seasonFindFirst },
    redraftWaiverClaim: { findMany: mocks.waiverClaimFindMany },
    redraftLeagueTransaction: { findMany: mocks.transactionFindMany },
    redraftTradeProposal: { findMany: mocks.proposalFindMany },
    leagueIntegritySettings: { findUnique: mocks.integritySettingsFindUnique },
    integrityFlag: { count: mocks.integrityFlagCount },
  },
}))

vi.mock('@/lib/redraft-war-room/redraftWarRoomContext', () => ({
  buildRedraftWarRoomContext: mocks.buildContext,
}))

vi.mock('@/lib/redraft/ai/tradeAnalyzer', () => ({
  detectCollusion: mocks.detectCollusion,
}))

import {
  detectInactiveManagers,
  generateRuleRecommendations,
  moderateLeagueChat,
} from '@/lib/redraft/ai/commissionerAssistant'

function buildContext(teamCount = 12): RedraftWarRoomContext {
  const teams = Array.from({ length: teamCount }, (_, index) => ({
    rosterId: `roster-${index + 1}`,
    ownerId: `user-${index + 1}`,
    ownerName: `User ${index + 1}`,
    teamName: index === 0 ? 'Sleepy Team' : `Team ${index + 1}`,
    wins: index,
    losses: Math.max(0, 3 - index),
    ties: 0,
    pointsFor: 100 + index * 10,
    pointsAgainst: 90 + index * 10,
    streak: null,
    playoffSeed: index + 1,
    faabBalance: 100 - index,
    waiverPriority: index + 1,
    isEliminated: false,
    isUserTeam: index === 0,
    players:
      index === 0
        ? [
            {
              playerId: 'wr-1',
              playerName: 'Only Starter',
              position: 'WR',
              team: 'TM',
              slotType: 'WR',
              isStarterSlot: true,
              injuryStatus: null,
              byeWeek: null,
              weekProjection: 8,
              restOfSeasonProjection: null,
              floorProjection: null,
              ceilingProjection: null,
              projectionConfidenceScore: null,
              projectionConfidenceLevel: 'medium',
              projectionSource: 'provider',
              projectionReasons: [],
              seasonAvgActual: 8,
              adp: 77,
              hasNoValueSignal: false,
            },
          ]
        : [
            {
              playerId: `qb-${index + 1}`,
              playerName: `QB ${index + 1}`,
              position: 'QB',
              team: 'TM',
              slotType: 'QB',
              isStarterSlot: true,
              injuryStatus: null,
              byeWeek: null,
              weekProjection: 18,
              restOfSeasonProjection: null,
              floorProjection: null,
              ceilingProjection: null,
              projectionConfidenceScore: null,
              projectionConfidenceLevel: 'high',
              projectionSource: 'provider',
              projectionReasons: [],
              seasonAvgActual: 18,
              adp: 20,
              hasNoValueSignal: false,
            },
            {
              playerId: `rb-${index + 1}`,
              playerName: `RB ${index + 1}`,
              position: 'RB',
              team: 'TM',
              slotType: 'RB',
              isStarterSlot: true,
              injuryStatus: null,
              byeWeek: null,
              weekProjection: 13,
              restOfSeasonProjection: null,
              floorProjection: null,
              ceilingProjection: null,
              projectionConfidenceScore: null,
              projectionConfidenceLevel: 'high',
              projectionSource: 'provider',
              projectionReasons: [],
              seasonAvgActual: 13,
              adp: 32,
              hasNoValueSignal: false,
            },
            {
              playerId: `wr-${index + 1}`,
              playerName: `WR ${index + 1}`,
              position: 'WR',
              team: 'TM',
              slotType: 'WR',
              isStarterSlot: true,
              injuryStatus: null,
              byeWeek: null,
              weekProjection: 11,
              restOfSeasonProjection: null,
              floorProjection: null,
              ceilingProjection: null,
              projectionConfidenceScore: null,
              projectionConfidenceLevel: 'high',
              projectionSource: 'provider',
              projectionReasons: [],
              seasonAvgActual: 11,
              adp: 45,
              hasNoValueSignal: false,
            },
          ],
  }))

  return {
    leagueId: 'league-1',
    leagueType: 'redraft',
    sport: 'NFL',
    season: 2026,
    currentWeek: 8,
    totalWeeks: 17,
    playoffStartWeek: 15,
    seasonStatus: 'active',
    scoring: {
      sport: 'NFL',
      scoringPreset: 'PPR',
      pointsPerReception: 1,
      superflex: false,
      tePremium: false,
      idp: false,
    },
    roster: {
      totalStarterSlots: 3,
      benchSlots: 6,
      irSlots: 1,
      lineupSlots: [
        { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'WR', allowedPositions: ['WR'], starterCount: 1, isFlex: false, isSuperflex: false },
      ],
      requiredByPosition: { QB: 1, RB: 1, WR: 1 },
    },
    waivers: { type: 'rolling', faabBudget: null },
    userRosterId: 'roster-1',
    isCommissioner: true,
    teams,
    upcomingMatchup: null,
    recentMatchup: null,
    freeAgents: [],
    availability: {
      scoringRules: 'available',
      rosterRules: 'available',
      standings: 'available',
      schedule: 'available',
      playerStats: 'available',
      projections: 'missing',
      injuries: 'missing',
      news: 'available',
      waiverPool: 'missing',
      tradeValues: 'available',
    },
    freshness: {
      generatedAt: new Date().toISOString(),
      statsAsOf: null,
      projectionsAsOf: null,
      injuriesAsOf: null,
    },
    missingDataFlags: ['No player projections available yet.', 'No injury data available.'],
    nflDataCoverage: null,
    featureAvailability: {
      teamNeeds: true,
      lineup: true,
      waivers: false,
      tradeAnalyze: true,
      tradeFind: true,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.seasonFindFirst.mockResolvedValue({
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 8,
    playoffStartWeek: 15,
  })
  mocks.waiverClaimFindMany.mockResolvedValue([])
  mocks.transactionFindMany.mockResolvedValue([])
  mocks.proposalFindMany.mockResolvedValue([])
  mocks.integritySettingsFindUnique.mockResolvedValue({
    collusionMonitoringEnabled: false,
    collusionSensitivity: 'high',
  })
  mocks.integrityFlagCount.mockResolvedValue(2)
  mocks.detectCollusion.mockResolvedValue([
    {
      tradeId: 'legacy-1',
      reason: 'Value imbalance between repeated trade partners.',
      severity: 'high',
    },
  ])
  mocks.buildContext.mockResolvedValue({
    ok: true,
    context: buildContext(),
  })
})

describe('redraft commissioner AI', () => {
  it('flags inactive managers from real roster and activity signals', async () => {
    const alerts = await detectInactiveManagers('season-1', 'commissioner-1')

    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0]?.reasons.join(' ')).toMatch(/No recent|starting slot|critical/i)
    expect(alerts[0]?.recommendedActions.length).toBeGreaterThan(0)
  })

  it('returns grounded rule recommendations instead of an empty list', async () => {
    const recommendations = await generateRuleRecommendations('league-1', 'season-1', 'commissioner-1')

    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations.map((rec) => rec.category)).toEqual(
      expect.arrayContaining(['engagement', 'integrity', 'waivers', 'data']),
    )
  })

  it('blocks obvious collusion language in commissioner chat moderation', async () => {
    const moderation = await moderateLeagueChat(
      'Bench your starters and I will split the winnings with you.',
      'league-1',
    )

    expect(moderation.allow).toBe(false)
    expect(moderation.action).toBe('block')
    expect(moderation.flags).toContain('possible_collusion_language')
  })
})
