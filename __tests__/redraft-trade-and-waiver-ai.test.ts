import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedraftWarRoomContext } from '@/lib/redraft-war-room/types'

const mocks = vi.hoisted(() => ({
  proposalFindUnique: vi.fn(),
  legacyTradeFindFirst: vi.fn(),
  integrityFlagFindMany: vi.fn(),
  seasonFindFirst: vi.fn(),
  buildContext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findUnique: mocks.proposalFindUnique },
    redraftLeagueTrade: { findFirst: mocks.legacyTradeFindFirst },
    integrityFlag: { findMany: mocks.integrityFlagFindMany },
    redraftSeason: { findFirst: mocks.seasonFindFirst },
  },
}))

vi.mock('@/lib/redraft-war-room/redraftWarRoomContext', () => ({
  buildRedraftWarRoomContext: mocks.buildContext,
}))

import { analyzeTrade } from '@/lib/redraft/ai/tradeAnalyzer'
import { generateWaiverRecs } from '@/lib/redraft/ai/waiverAnalyzer'

function makePlayer(args: {
  id: string
  name: string
  position: string
  slotType?: string
  projection?: number | null
  adp?: number | null
  seasonAvg?: number | null
}) {
  return {
    playerId: args.id,
    playerName: args.name,
    position: args.position,
    team: 'TM',
    slotType: args.slotType ?? 'bench',
    isStarterSlot: (args.slotType ?? 'bench') !== 'bench' && (args.slotType ?? 'bench') !== 'free_agent',
    injuryStatus: null,
    byeWeek: null,
    weekProjection: args.projection ?? null,
    restOfSeasonProjection: null,
    floorProjection: null,
    ceilingProjection: null,
    projectionConfidenceScore: null,
    projectionConfidenceLevel: args.projection != null ? 'medium' : 'none',
    projectionSource: args.projection != null ? 'provider' : null,
    projectionReasons: [],
    seasonAvgActual: args.seasonAvg ?? null,
    adp: args.adp ?? null,
    hasNoValueSignal: args.projection == null && args.adp == null && args.seasonAvg == null,
  }
}

function makeContext(options?: {
  noValueSignals?: boolean
  missingWaiverPool?: boolean
}): RedraftWarRoomContext {
  const noValueSignals = options?.noValueSignals === true
  const missingWaiverPool = options?.missingWaiverPool === true

  const rb = makePlayer({
    id: 'rb-2',
    name: 'Runner Two',
    position: 'RB',
    slotType: 'RB',
    projection: noValueSignals ? null : 14,
    adp: noValueSignals ? null : 30,
  })
  const wr = makePlayer({
    id: 'wr-1',
    name: 'Wideout One',
    position: 'WR',
    slotType: 'WR',
    projection: noValueSignals ? null : 9,
    adp: noValueSignals ? null : 60,
  })

  return {
    leagueId: 'league-1',
    leagueType: 'redraft',
    sport: 'NFL',
    season: 2026,
    currentWeek: 5,
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
      benchSlots: 5,
      irSlots: 1,
      lineupSlots: [
        { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'WR', allowedPositions: ['WR'], starterCount: 1, isFlex: false, isSuperflex: false },
      ],
      requiredByPosition: { QB: 1, RB: 1, WR: 1 },
    },
    waivers: { type: 'faab', faabBudget: 100 },
    userRosterId: 'roster-1',
    isCommissioner: true,
    teams: [
      {
        rosterId: 'roster-1',
        ownerId: 'user-1',
        ownerName: 'User One',
        teamName: 'Alpha',
        wins: 3,
        losses: 1,
        ties: 0,
        pointsFor: 520,
        pointsAgainst: 450,
        streak: 'W2',
        playoffSeed: 2,
        faabBalance: 77,
        waiverPriority: 2,
        isEliminated: false,
        isUserTeam: true,
        players: [
          makePlayer({
            id: 'qb-1',
            name: 'Quarterback One',
            position: 'QB',
            slotType: 'QB',
            projection: noValueSignals ? null : 19,
            adp: noValueSignals ? null : 22,
          }),
          wr,
          makePlayer({
            id: 'te-bench',
            name: 'Bench Tight End',
            position: 'TE',
            slotType: 'bench',
            projection: noValueSignals ? null : 4,
            adp: noValueSignals ? null : 180,
          }),
        ],
      },
      {
        rosterId: 'roster-2',
        ownerId: 'user-2',
        ownerName: 'User Two',
        teamName: 'Bravo',
        wins: 2,
        losses: 2,
        ties: 0,
        pointsFor: 480,
        pointsAgainst: 500,
        streak: 'L1',
        playoffSeed: 6,
        faabBalance: 91,
        waiverPriority: 7,
        isEliminated: false,
        isUserTeam: false,
        players: [
          makePlayer({
            id: 'qb-2',
            name: 'Quarterback Two',
            position: 'QB',
            slotType: 'QB',
            projection: noValueSignals ? null : 18,
            adp: noValueSignals ? null : 28,
          }),
          rb,
        ],
      },
    ],
    upcomingMatchup: null,
    recentMatchup: null,
    freeAgents: missingWaiverPool
      ? []
      : [
          makePlayer({
            id: 'fa-rb',
            name: 'Free Agent Back',
            position: 'RB',
            slotType: 'free_agent',
            projection: 11,
            adp: 45,
          }),
          makePlayer({
            id: 'fa-wr',
            name: 'Free Agent Wideout',
            position: 'WR',
            slotType: 'free_agent',
            projection: 7,
            adp: 88,
          }),
        ],
    availability: {
      scoringRules: 'available',
      rosterRules: 'available',
      standings: 'available',
      schedule: 'available',
      playerStats: noValueSignals ? 'missing' : 'available',
      projections: noValueSignals ? 'missing' : 'available',
      injuries: 'available',
      news: 'available',
      waiverPool: missingWaiverPool ? 'missing' : 'available',
      tradeValues: noValueSignals ? 'missing' : 'available',
    },
    freshness: {
      generatedAt: new Date().toISOString(),
      statsAsOf: null,
      projectionsAsOf: null,
      injuriesAsOf: null,
    },
    missingDataFlags: noValueSignals ? ['No player projections available yet.'] : [],
    nflDataCoverage: null,
    featureAvailability: {
      teamNeeds: true,
      lineup: true,
      waivers: !missingWaiverPool,
      tradeAnalyze: true,
      tradeFind: !noValueSignals,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.legacyTradeFindFirst.mockResolvedValue(null)
  mocks.integrityFlagFindMany.mockResolvedValue([])
  mocks.seasonFindFirst.mockResolvedValue({
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 5,
  })
  mocks.proposalFindUnique.mockResolvedValue({
    id: 'proposal-1',
    leagueId: 'league-1',
    seasonId: 'season-1',
    status: 'pending',
    proposerRosterId: 'roster-1',
    receiverRosterId: 'roster-2',
    proposerRoster: { id: 'roster-1', teamName: 'Alpha', ownerName: 'User One' },
    receiverRoster: { id: 'roster-2', teamName: 'Bravo', ownerName: 'User Two' },
    assets: [
      {
        assetType: 'player',
        fromRosterId: 'roster-1',
        toRosterId: 'roster-2',
        playerId: 'wr-1',
        playerName: 'Wideout One',
      },
      {
        assetType: 'player',
        fromRosterId: 'roster-2',
        toRosterId: 'roster-1',
        playerId: 'rb-2',
        playerName: 'Runner Two',
      },
    ],
    valueSnapshot: {
      grade: 'B',
      fairnessScore: 78,
      confidenceScore: 71,
      valueDifference: 11,
    },
  })
  mocks.buildContext.mockResolvedValue({
    ok: true,
    context: makeContext(),
  })
})

describe('redraft paid trade AI', () => {
  it('returns grounded structured trade analysis instead of a placeholder', async () => {
    const analysis = await analyzeTrade('user-1', 'proposal-1')

    expect(analysis).toBeTruthy()
    expect(analysis?.summary).not.toContain('pending wiring')
    expect(analysis?.recommendation).toBeTruthy()
    expect(analysis?.sideAImpact.teamName).toBe('Alpha')
    expect(analysis?.sideBImpact.teamName).toBe('Bravo')
    expect(analysis?.source).toBe('deterministic_redraft_war_room')
    expect(analysis?.snapshot?.grade).toBe('B')
  })

  it('returns safe missing-data guidance instead of fabricating analysis', async () => {
    mocks.buildContext.mockResolvedValue({
      ok: true,
      context: makeContext({ noValueSignals: true }),
    })

    const analysis = await analyzeTrade('user-1', 'proposal-1')

    expect(analysis?.recommendation).toBe('needs_more_data')
    expect(analysis?.dataWarnings.join(' ')).toMatch(/missing|No projection|value signal/i)
    expect(analysis?.sideAImpact.verdict).toBe('needs_more_data')
  })
})

describe('redraft paid waiver AI', () => {
  it('returns ranked adds, drop candidates, and faab guidance from real redraft context', async () => {
    const analysis = await generateWaiverRecs('user-1', 'roster-1', 'season-1', 5)

    expect(analysis).toBeTruthy()
    expect(analysis?.rankedAdds.length).toBeGreaterThan(0)
    expect(analysis?.rankedAdds[0]?.position).toBe('RB')
    expect(analysis?.faabGuidance.enabled).toBe(true)
    expect(analysis?.faabGuidance.topBidSuggestion).toBeTypeOf('number')
    expect(analysis?.source).toBe('deterministic_redraft_war_room')
  })

  it('returns drop-side fallback and data warnings when the waiver pool is missing', async () => {
    mocks.buildContext.mockResolvedValue({
      ok: true,
      context: makeContext({ missingWaiverPool: true }),
    })

    const analysis = await generateWaiverRecs('user-1', 'roster-1', 'season-1', 7)

    expect(analysis?.rankedAdds).toHaveLength(0)
    expect(analysis?.suggestedDrops.length).toBeGreaterThan(0)
    expect(analysis?.dataWarnings.join(' ')).toMatch(/waiver|free-agent pool|requested week/i)
  })
})
