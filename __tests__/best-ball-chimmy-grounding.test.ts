import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BestBallWarRoomContext } from '@/lib/best-ball-war-room/types'

const mocks = vi.hoisted(() => ({ buildContext: vi.fn() }))

vi.mock('@/lib/best-ball-war-room/bestBallWarRoomContext', () => ({
  buildBestBallWarRoomContext: mocks.buildContext,
}))

import { buildBestBallContextForChimmy } from '@/lib/best-ball-war-room/bestBallChimmyGrounding'

function makeContext(): BestBallWarRoomContext {
  const p = (id: string, position: string, team: string, adp: number, max: number) => ({
    playerId: id,
    playerName: `Player ${id}`,
    position,
    team,
    byeWeek: 7,
    injuryStatus: null,
    adp,
    adpRound: Math.max(1, Math.ceil(adp / 12)),
    avgPoints: null,
    maxPoints: max,
    startedWeeks: 4,
    weekProjection: null,
    hasNoValueSignal: false,
  })
  return {
    leagueId: 'lg1',
    leagueType: 'best_ball',
    ruleConfigurationVerified: true,
    sport: 'NFL',
    season: 2026,
    teamCount: 12,
    draftComplete: true,
    scoring: { sport: 'NFL', scoringPreset: 'PPR', scoringPeriod: 'weekly', matchupFormat: 'h2h', cumulative: false },
    roster: {
      lineupSlots: [
        { code: 'QB', count: 1, allowedPositions: ['QB'] },
        { code: 'RB', count: 2, allowedPositions: ['RB'] },
        { code: 'WR', count: 3, allowedPositions: ['WR'] },
        { code: 'TE', count: 1, allowedPositions: ['TE'] },
        { code: 'FLEX', count: 2, allowedPositions: ['RB', 'WR', 'TE'] },
      ],
      startingSlots: 9,
      recommendedRosterSize: 18,
      recommendedBenchSize: 9,
      requiredByPosition: { QB: 1, RB: 2, WR: 3, TE: 1 },
      flexSlots: [{ code: 'FLEX', count: 2, allowedPositions: ['RB', 'WR', 'TE'] }],
    },
    bestBall: { mode: 'standard', draftMode: 'snake', contestStructure: 'season_long', waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false, regularSeasonLength: 14, draftComplete: true },
    userRosterId: 'r1',
    isCommissioner: false,
    teams: [
      {
        rosterId: 'r1',
        ownerId: 'u1',
        ownerName: 'Me',
        teamName: 'My Team',
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        playoffSeed: null,
        isUserTeam: true,
        players: [p('qb', 'QB', 'BUF', 30, 30), p('wr', 'WR', 'BUF', 12, 28), p('rb', 'RB', 'ATL', 8, 26)],
      },
    ],
    availability: {
      scoringRules: 'available',
      rosterRules: 'available',
      rosters: 'available',
      playerValues: 'available',
      weeklyScores: 'available',
      projections: 'missing',
      injuries: 'available',
      news: 'available',
      teamData: 'available',
      byeWeeks: 'available',
      standings: 'missing',
    },
    freshness: { generatedAt: 'now', scoresAsOf: null, injuriesAsOf: null },
    missingDataFlags: ['Waivers are disabled in this best-ball league (draft-only).'],
    featureAvailability: {
      rosterConstruction: true,
      depth: true,
      upside: true,
      draftPlan: true,
      stacks: true,
      waivers: false,
      tradeAnalyze: false,
      tradeFind: false,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildContext.mockResolvedValue({ ok: true, context: makeContext() })
})

describe('buildBestBallContextForChimmy', () => {
  it('returns null when no leagueId/userId', async () => {
    expect(await buildBestBallContextForChimmy('', 'u1')).toBeNull()
    expect(await buildBestBallContextForChimmy('lg1', '')).toBeNull()
  })

  it('returns null when the context build is not ok (non-best-ball / forbidden)', async () => {
    mocks.buildContext.mockResolvedValue({ ok: false, status: 404, error: 'Not a Best Ball league' })
    expect(await buildBestBallContextForChimmy('lg1', 'u1')).toBeNull()
  })

  it('grounds a best-ball league with auto-lineup rules, construction, and stacks', async () => {
    const out = await buildBestBallContextForChimmy('lg1', 'u1')
    expect(out).toBeTruthy()
    const text = out as string
    expect(text).toMatch(/BEST BALL AF WAR ROOM CONTEXT/)
    expect(text).toMatch(/AUTOMATIC LINEUP/)
    expect(text.toLowerCase()).toMatch(/never give a start\/sit/)
    expect(text).toMatch(/ROSTER CONSTRUCTION/)
    expect(text).toMatch(/STACKS \/ CORRELATION/)
  })

  it('withholds default transaction and scoring rules when an imported league did not verify them', async () => {
    mocks.buildContext.mockResolvedValue({ ok: true, context: { ...makeContext(), ruleConfigurationVerified: false } })
    const out = await buildBestBallContextForChimmy('lg1', 'u1')
    expect(out).toContain('UNVERIFIED')
    expect(out).toContain('automatic')
    expect(out).not.toContain('waivers=OFF')
    expect(out).not.toContain('Waivers are disabled')
    expect(out).not.toContain('Scoring:')
    expect(out).not.toContain('ROSTER CONSTRUCTION')
  })
})
