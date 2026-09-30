import { describe, expect, it } from 'vitest'
import { adpToValue, ceilingValue, draftValue } from '@/lib/best-ball-war-room/bestBallValue'
import { evaluateRosterConstruction } from '@/lib/best-ball-war-room/bestBallRosterConstructionEngine'
import { evaluateDepth } from '@/lib/best-ball-war-room/bestBallDepthEngine'
import { evaluateUpside } from '@/lib/best-ball-war-room/bestBallUpsideEngine'
import { buildBestBallDraftPlan } from '@/lib/best-ball-war-room/bestBallDraftPlanEngine'
import { evaluateStacks } from '@/lib/best-ball-war-room/bestBallStackCorrelationEngine'
import { evaluateRisk } from '@/lib/best-ball-war-room/bestBallRiskEngine'
import { buildBestBallWaiverRecommendations } from '@/lib/best-ball-war-room/bestBallWaiverEngine'
import { analyzeBestBallTrade, findBestBallTradeTargets } from '@/lib/best-ball-war-room/bestBallTradeEngine'
import { WAR_ROOM_PRIVATE_SCALE } from './war-room/warRoomPrivateScale'
import { BEST_BALL_WAR_ROOM_SYSTEM_RULES, buildBestBallWarRoomPrompt } from '@/lib/best-ball-war-room/bestBallWarRoomPrompt'
import type {
  BestBallDataAvailability,
  BestBallPlayerFact,
  BestBallTeamSummary,
  BestBallWarRoomContext,
} from '@/lib/best-ball-war-room/types'

const TEAM_COUNT = 12

function player(p: Partial<BestBallPlayerFact> & { playerId: string; position: string }): BestBallPlayerFact {
  const adp = p.adp ?? null
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? null,
    byeWeek: p.byeWeek ?? null,
    injuryStatus: p.injuryStatus ?? null,
    adp,
    adpRound: p.adpRound ?? (adp != null ? Math.max(1, Math.ceil(adp / TEAM_COUNT)) : null),
    avgPoints: p.avgPoints ?? null,
    maxPoints: p.maxPoints ?? null,
    startedWeeks: p.startedWeeks ?? null,
    weekProjection: p.weekProjection ?? null,
    hasNoValueSignal: p.adp == null && p.maxPoints == null && p.avgPoints == null && p.weekProjection == null,
  }
}

const FULL_AVAILABILITY: BestBallDataAvailability = {
  scoringRules: 'available',
  rosterRules: 'available',
  rosters: 'available',
  playerValues: 'available',
  weeklyScores: 'missing',
  projections: 'missing',
  injuries: 'available',
  news: 'available',
  teamData: 'available',
  byeWeeks: 'available',
  standings: 'available',
}

function team(over: Partial<BestBallTeamSummary> & { rosterId: string }): BestBallTeamSummary {
  return {
    rosterId: over.rosterId,
    ownerId: over.ownerId ?? `owner-${over.rosterId}`,
    ownerName: over.ownerName ?? `Owner ${over.rosterId}`,
    teamName: over.teamName ?? `Team ${over.rosterId}`,
    wins: over.wins ?? 0,
    losses: over.losses ?? 0,
    ties: over.ties ?? 0,
    pointsFor: over.pointsFor ?? 0,
    playoffSeed: over.playoffSeed ?? null,
    isUserTeam: over.isUserTeam ?? false,
    players: over.players ?? [],
  }
}

function makeContext(over: Partial<BestBallWarRoomContext> = {}): BestBallWarRoomContext {
  const availability = { ...FULL_AVAILABILITY, ...(over.availability ?? {}) }
  const { availability: _a, featureAvailability: _f, bestBall: _b, ...rest } = over
  const bestBall = {
    mode: 'standard',
    draftMode: 'snake',
    contestStructure: 'season_long',
    waiversEnabled: false,
    tradesEnabled: false,
    substitutionsEnabled: false,
    regularSeasonLength: 14,
    draftComplete: true,
    ...(over.bestBall ?? {}),
  }
  const adpAvailable = availability.playerValues === 'available'
  return {
    leagueId: 'lg1',
    leagueType: 'best_ball',
    ruleConfigurationVerified: true,
    sport: 'NFL',
    season: 2026,
    teamCount: TEAM_COUNT,
    draftComplete: true,
    scoring: { sport: 'NFL', scoringPreset: 'PPR', scoringPeriod: 'weekly', matchupFormat: 'h2h', cumulative: false },
    roster: {
      // NFL best-ball profile: QBx1 RBx2 WRx3 TEx1 FLEXx2(RB/WR/TE) = 9 starters.
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
    bestBall,
    userRosterId: 'r1',
    isCommissioner: false,
    teams: over.teams ?? [],
    availability,
    freshness: { generatedAt: new Date().toISOString(), scoresAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: {
      rosterConstruction: true,
      depth: true,
      upside: adpAvailable,
      draftPlan: true,
      stacks: availability.teamData === 'available',
      waivers: bestBall.waiversEnabled,
      tradeAnalyze: bestBall.tradesEnabled,
      tradeFind: bestBall.tradesEnabled && adpAvailable,
      ...(over.featureAvailability ?? {}),
    },
    ...rest,
  }
}

// A roster thin at QB/RB/TE, HEAVY at WR, with a same-team QB stack + a bye cluster.
function userRoster(): BestBallTeamSummary {
  return team({
    rosterId: 'r1',
    isUserTeam: true,
    players: [
      player({ playerId: 'qb1', position: 'QB', team: 'BUF', adp: 30, maxPoints: 32, avgPoints: 20, startedWeeks: 5, byeWeek: 7 }),
      player({ playerId: 'rb1', position: 'RB', team: 'ATL', adp: 8, maxPoints: 28, avgPoints: 16, byeWeek: 7 }),
      player({ playerId: 'rb2', position: 'RB', team: 'DET', adp: 40, maxPoints: 22, avgPoints: 12, byeWeek: 7 }),
      player({ playerId: 'wr1', position: 'WR', team: 'BUF', adp: 12, maxPoints: 30, avgPoints: 17, byeWeek: 7 }),
      player({ playerId: 'wr2', position: 'WR', team: 'MIN', adp: 24, maxPoints: 26, avgPoints: 14, byeWeek: 7 }),
      player({ playerId: 'wr3', position: 'WR', team: 'DAL', adp: 36, maxPoints: 24, avgPoints: 13 }),
      player({ playerId: 'wr4', position: 'WR', team: 'LAC', adp: 60, maxPoints: 20, avgPoints: 11 }),
      player({ playerId: 'wr5', position: 'WR', team: 'CIN', adp: 80, maxPoints: 18, avgPoints: 10 }),
      player({ playerId: 'wr6', position: 'WR', team: 'SEA', adp: 95, maxPoints: 16, avgPoints: 9 }),
      player({ playerId: 'wr7', position: 'WR', team: 'GB', adp: 110, maxPoints: 15, avgPoints: 8 }),
      player({ playerId: 'wr8', position: 'WR', team: 'NYJ', adp: 130, maxPoints: 14, avgPoints: 7 }),
      player({ playerId: 'te1', position: 'TE', team: 'KC', adp: 35, maxPoints: 19, avgPoints: 10 }),
    ],
  })
}

// --- value helpers ------------------------------------------------------------

describe('best ball value helpers', () => {
  it('maps ADP to a decreasing value', () => {
    expect(adpToValue(10)).toBeGreaterThan(adpToValue(100))
  })
  it('ceiling prefers real max weekly → avg → projection → ADP', () => {
    expect(ceilingValue(player({ playerId: 'a', position: 'WR', maxPoints: 30 })).source).toBe('weekly_max')
    expect(ceilingValue(player({ playerId: 'b', position: 'WR', avgPoints: 12 })).source).toBe('weekly_avg')
    expect(ceilingValue(player({ playerId: 'c', position: 'WR', weekProjection: 14 })).source).toBe('projection')
    expect(ceilingValue(player({ playerId: 'd', position: 'WR', adp: 20 })).source).toBe('adp')
    expect(draftValue(player({ playerId: 'e', position: 'WR' })).source).toBe('none')
  })
})

// --- roster construction + depth ----------------------------------------------

describe('bestBallRosterConstructionEngine', () => {
  it('identifies thin (QB/TE) and heavy (WR) positions; never emits start/sit', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = evaluateRosterConstruction(ctx, 'r1')
    expect(res.underInvested).toContain('QB')
    expect(res.underInvested).toContain('TE')
    expect(res.overInvested).toContain('WR')
    // No manual start/sit advice anywhere in the output (best ball is auto-lineup).
    expect(JSON.stringify(res)).not.toMatch(/start\/sit|sit him|bench him|should start|should sit/i)
  })
})

describe('bestBallDepthEngine', () => {
  it('flags fragile positions (QB/TE have no buffer)', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = evaluateDepth(ctx, 'r1')
    expect(res.fragilePositions).toContain('QB')
    expect(res.fragilePositions).toContain('TE')
    expect(res.fragilePositions).not.toContain('WR')
  })
})

// --- upside -------------------------------------------------------------------

describe('bestBallUpsideEngine', () => {
  it('ranks by real max weekly score with high confidence when scores exist', () => {
    const ctx = makeContext({ teams: [userRoster()], availability: { weeklyScores: 'available' } })
    const res = evaluateUpside(ctx, 'r1')
    expect(res.confidence).toBe('high')
    expect(res.topUpside[0].source).toBe('weekly_max')
  })

  it('falls back to ADP proxy with low confidence when no scores', () => {
    const noScores = team({
      rosterId: 'r1',
      isUserTeam: true,
      players: [player({ playerId: 'w', position: 'WR', adp: 12 }), player({ playerId: 'r', position: 'RB', adp: 40 })],
    })
    const ctx = makeContext({ teams: [noScores] })
    const res = evaluateUpside(ctx, 'r1')
    expect(res.confidence).toBe('low')
    expect(res.topUpside[0].source).toBe('adp')
  })
})

// --- draft plan ---------------------------------------------------------------

describe('bestBallDraftPlanEngine', () => {
  it('targets thin positions for depth (QB/TE)', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const plan = buildBestBallDraftPlan(ctx, 'r1')
    const positions = plan.targets.map((t) => t.position)
    expect(positions).toContain('QB')
    expect(positions).toContain('TE')
    expect(plan.targets.find((t) => t.position === 'QB')?.priority).toBe('high')
  })
})

// --- stacks + risk ------------------------------------------------------------

describe('bestBallStackCorrelationEngine', () => {
  it('detects a real same-team QB stack and a bye cluster', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = evaluateStacks(ctx, 'r1')
    const buf = res.stacks.find((s) => s.team === 'BUF')
    expect(buf).toBeTruthy()
    expect(buf?.hasQbStack).toBe(true) // QB + WR on BUF
    expect(res.byeClusters.some((c) => c.week === 7)).toBe(true) // 5 players bye W7
  })

  it('is limited when team data is unavailable', () => {
    const ctx = makeContext({ teams: [userRoster()], availability: { teamData: 'missing' } })
    const res = evaluateStacks(ctx, 'r1')
    expect(res.teamDataState).toBe('limited')
    expect(res.explanationFacts.join(' ')).toMatch(/limited/i)
  })
})

describe('bestBallRiskEngine', () => {
  it('aggregates fragile + bye-cluster risk into a score', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = evaluateRisk(ctx, 'r1')
    expect(res.riskScore).toBeGreaterThan(0)
    expect(res.fragilePositions.length).toBeGreaterThan(0)
  })
})

// --- waivers/trades disabled by default ---------------------------------------

describe('bestBallWaiver + trade (draft-only defaults)', () => {
  it('waivers return a truthful disabled state when waivers are off', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = buildBestBallWaiverRecommendations(ctx, 'r1')
    expect(res.enabled).toBe(false)
    expect(res.dropCandidates).toHaveLength(0)
  })

  it('trade analyze returns disabled when trades are off', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = analyzeBestBallTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['wr5'], incomingPlayerIds: [] })
    expect(res.verdict).toBe('disabled')
  })

  it('trade finder is disabled when trades are off', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = findBestBallTradeTargets(ctx, 'r1')
    expect(res.enabled).toBe(false)
  })

  it('waivers work when the league enables them', () => {
    const ctx = makeContext({ teams: [userRoster()], bestBall: { ...makeContext().bestBall, waiversEnabled: true } })
    const res = buildBestBallWaiverRecommendations(ctx, 'r1')
    expect(res.enabled).toBe(true)
    expect(res.dropCandidates.length).toBeGreaterThan(0)
  })

  it('trades work when the league enables them', () => {
    const me = userRoster()
    const other = team({ rosterId: 'r2', players: [player({ playerId: 'oqb', position: 'QB', team: 'PHI', adp: 20, maxPoints: 30 })] })
    const ctx = makeContext({ teams: [me, other], bestBall: { ...makeContext().bestBall, tradesEnabled: true } })
    const res = analyzeBestBallTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['wr5'], incomingPlayerIds: ['oqb'] })
    expect(res.verdict).not.toBe('disabled')
    expect(res.valueDelta).not.toBeNull()
    // 🛑 2026-09-29: the War Room's own value scale is not shown — the verdict is the one grade.
    expect([...res.explanationFacts, ...res.riskFlags, ...res.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })
})

// --- prompt -------------------------------------------------------------------

describe('bestBallWarRoomPrompt', () => {
  it('includes best-ball rules and forbids manual start/sit', () => {
    expect(BEST_BALL_WAR_ROOM_SYSTEM_RULES).toContain('Best Ball')
    expect(BEST_BALL_WAR_ROOM_SYSTEM_RULES).toContain('AUTOMATIC LINEUP')
    expect(BEST_BALL_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('never give a start/sit')
  })

  it('serializes context + engine outputs and explains the automatic lineup', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const prompt = buildBestBallWarRoomPrompt({
      context: ctx,
      construction: evaluateRosterConstruction(ctx, 'r1'),
      depth: evaluateDepth(ctx, 'r1'),
      upside: evaluateUpside(ctx, 'r1'),
      stacks: evaluateStacks(ctx, 'r1'),
    })
    expect(prompt).toContain('BEST BALL LEAGUE CONTEXT')
    expect(prompt).toContain('AUTOMATIC LINEUP')
    expect(prompt).toContain('ROSTER CONSTRUCTION')
    expect(prompt).toContain('STACKS / CORRELATION')
  })

  it('withholds generic roster targets and disabled-rule claims without explicit settings', () => {
    const context = makeContext({ ruleConfigurationVerified: false, teams: [userRoster()] })
    const prompt = buildBestBallWarRoomPrompt({ context, construction: evaluateRosterConstruction(context, 'r1') })
    expect(prompt).toContain('UNVERIFIED LEAGUE RULES')
    expect(prompt).not.toContain('waivers=OFF')
    expect(prompt).not.toContain('Auto-lineup slots:')
    expect(prompt).not.toContain('ROSTER CONSTRUCTION')
  })
})
