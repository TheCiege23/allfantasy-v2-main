import { describe, expect, it } from 'vitest'
import { evaluateSurvivalRisk } from '@/lib/guillotine-war-room/guillotineSurvivalRiskEngine'
import { evaluateRosterRisk } from '@/lib/guillotine-war-room/guillotineRosterRiskEngine'
import { evaluateLineupSafety } from '@/lib/guillotine-war-room/guillotineLineupSafetyEngine'
import { buildFaabPlan } from '@/lib/guillotine-war-room/guillotineFaabEngine'
import { buildWaiverRecommendations } from '@/lib/guillotine-war-room/guillotineWaiverEngine'
import { evaluateDroppedPlayers } from '@/lib/guillotine-war-room/guillotineDroppedPlayerEngine'
import { analyzeGuillotineTrade } from '@/lib/guillotine-war-room/guillotineTradeEngine'
import { WAR_ROOM_PRIVATE_SCALE } from './war-room/warRoomPrivateScale'
import { buildWeeklyPlan } from '@/lib/guillotine-war-room/guillotineWeeklyPlanEngine'
import { GUILLOTINE_WAR_ROOM_SYSTEM_RULES, buildGuillotineWarRoomPrompt } from '@/lib/guillotine-war-room/guillotineWarRoomPrompt'
import type {
  DangerTier,
  GuillotineDataAvailability,
  GuillotinePlayerFact,
  GuillotineStandingRow,
  GuillotineTeamSummary,
  GuillotineWarRoomContext,
} from '@/lib/guillotine-war-room/types'

function player(p: Partial<GuillotinePlayerFact> & { playerId: string; position: string }): GuillotinePlayerFact {
  const adp = p.adp ?? null
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? 'TM',
    slotType: p.slotType ?? 'bench',
    isStarterSlot: p.isStarterSlot ?? (p.slotType ? p.slotType === 'starter' : false),
    injuryStatus: p.injuryStatus ?? null,
    adp,
    weekProjection: p.weekProjection ?? null,
    seasonAvgActual: p.seasonAvgActual ?? null,
    hasNoValueSignal: p.weekProjection == null && adp == null,
  }
}

const FULL_AVAILABILITY: GuillotineDataAvailability = {
  config: 'available',
  rosters: 'available',
  periodScores: 'available',
  eliminationLine: 'available',
  rosterStates: 'available',
  playerValues: 'available',
  projections: 'available',
  injuries: 'available',
  news: 'available',
  faab: 'available',
  droppedPlayerPool: 'missing',
}

function team(over: Partial<GuillotineTeamSummary> & { rosterId: string }): GuillotineTeamSummary {
  return {
    rosterId: over.rosterId,
    ownerId: over.ownerId ?? `owner-${over.rosterId}`,
    ownerName: over.ownerName ?? `Owner ${over.rosterId}`,
    teamName: over.teamName ?? `Team ${over.rosterId}`,
    isUserTeam: over.isUserTeam ?? false,
    eliminated: over.eliminated ?? false,
    faabRemaining: 'faabRemaining' in over ? (over.faabRemaining ?? null) : 100,
    players: over.players ?? [],
  }
}

function standing(over: Partial<GuillotineStandingRow> & { rosterId: string; tier: DangerTier }): GuillotineStandingRow {
  return {
    rosterId: over.rosterId,
    ownerName: over.ownerName ?? `Owner ${over.rosterId}`,
    teamName: over.teamName ?? `Team ${over.rosterId}`,
    isUserTeam: over.isUserTeam ?? false,
    eliminated: over.eliminated ?? false,
    choppedInPeriod: over.choppedInPeriod ?? null,
    rank: over.rank ?? null,
    seasonPointsCumul: over.seasonPointsCumul ?? 0,
    periodPoints: over.periodPoints ?? null,
    tier: over.tier,
    pointsFromChopZone: over.pointsFromChopZone ?? null,
  }
}

function fullRoster(rosterId: string, isUser: boolean, opts?: { thinQb?: boolean; injuredRb?: boolean }): GuillotineTeamSummary {
  const players: GuillotinePlayerFact[] = [
    ...(opts?.thinQb ? [] : [player({ playerId: `${rosterId}-qb`, position: 'QB', slotType: 'starter', weekProjection: 20, adp: 30 })]),
    player({ playerId: `${rosterId}-rb1`, position: 'RB', slotType: 'starter', weekProjection: 14, adp: 12, injuryStatus: opts?.injuredRb ? 'Out' : null }),
    player({ playerId: `${rosterId}-rb2`, position: 'RB', slotType: 'starter', weekProjection: 11, adp: 40 }),
    player({ playerId: `${rosterId}-wr1`, position: 'WR', slotType: 'starter', weekProjection: 16, adp: 8 }),
    player({ playerId: `${rosterId}-wr2`, position: 'WR', slotType: 'starter', weekProjection: 12, adp: 24 }),
    player({ playerId: `${rosterId}-wr3`, position: 'WR', slotType: 'starter', weekProjection: 9, adp: 60 }),
    player({ playerId: `${rosterId}-te`, position: 'TE', slotType: 'starter', weekProjection: 8, adp: 70 }),
    player({ playerId: `${rosterId}-bench1`, position: 'RB', slotType: 'bench', weekProjection: 6, adp: 120 }),
    player({ playerId: `${rosterId}-bench2`, position: 'WR', slotType: 'bench', weekProjection: 18, adp: 90 }),
  ]
  return team({ rosterId, isUserTeam: isUser, players })
}

function makeContext(over: Partial<GuillotineWarRoomContext> = {}): GuillotineWarRoomContext {
  const availability = { ...FULL_AVAILABILITY, ...(over.availability ?? {}) }
  const { availability: _a, featureAvailability: _f, guillotine: _g, ...rest } = over
  const guillotine = {
    eliminationStartWeek: 1,
    eliminationEndWeek: 17,
    teamsPerChop: 1,
    dangerMarginPoints: 10,
    tiebreaker: 'season_points',
    rosterReleaseTiming: 'next_waiver_run',
    tradesEnabled: false,
    ...(over.guillotine ?? {}),
  }
  const survivalAvailable = availability.eliminationLine === 'available'
  return {
    leagueId: 'lg1',
    leagueType: 'guillotine',
    sport: 'NFL',
    season: 2026,
    currentWeek: 5,
    scoring: { sport: 'NFL', scoringPreset: 'PPR' },
    roster: { totalStarterSlots: 7, benchSlots: 5, requiredByPosition: { QB: 1, RB: 3, WR: 3, TE: 1 } },
    guillotine,
    userRosterId: 'r1',
    isCommissioner: false,
    standings: over.standings ?? [],
    activeTeamCount: over.activeTeamCount ?? 0,
    eliminatedTeamCount: over.eliminatedTeamCount ?? 0,
    teams: over.teams ?? [],
    droppedPlayers: over.droppedPlayers ?? [],
    availability,
    freshness: { generatedAt: new Date().toISOString(), scoresAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: {
      survivalRisk: survivalAvailable,
      rosterRisk: true,
      lineupSafety: true,
      waivers: true,
      faabPlan: true,
      droppedPlayers: availability.droppedPlayerPool === 'available',
      tradeAnalyze: guillotine.tradesEnabled,
      weeklyPlan: true,
      ...(over.featureAvailability ?? {}),
    },
    ...rest,
  }
}

// --- survival risk ------------------------------------------------------------

describe('guillotineSurvivalRiskEngine', () => {
  it('flags a chop-zone team as critical', () => {
    const ctx = makeContext({
      activeTeamCount: 8,
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0, seasonPointsCumul: 400 })],
    })
    const res = evaluateSurvivalRisk(ctx, 'r1')
    expect(res.riskLevel).toBe('critical')
    expect(res.safetyMargin).toBe(0)
  })

  it('flags a safe team as safe', () => {
    const ctx = makeContext({
      activeTeamCount: 8,
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'safe', rank: 8, pointsFromChopZone: 45, seasonPointsCumul: 600 })],
    })
    expect(evaluateSurvivalRisk(ctx, 'r1').riskLevel).toBe('safe')
  })

  it('returns limited when the elimination line is unavailable', () => {
    const ctx = makeContext({
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'unknown', pointsFromChopZone: null })],
      availability: { eliminationLine: 'missing' },
    })
    expect(evaluateSurvivalRisk(ctx, 'r1').riskLevel).toBe('limited')
  })

  it('reports eliminated teams', () => {
    const ctx = makeContext({ standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'unknown', eliminated: true, choppedInPeriod: 3 })] })
    expect(evaluateSurvivalRisk(ctx, 'r1').riskLevel).toBe('eliminated')
  })
})

// --- roster risk + lineup safety ----------------------------------------------

describe('guillotineRosterRiskEngine', () => {
  it('flags a structural hole (no QB) as critical and raises floor risk', () => {
    const ctx = makeContext({ teams: [fullRoster('r1', true, { thinQb: true })] })
    const res = evaluateRosterRisk(ctx, 'r1')
    expect(res.weaknesses.some((w) => w.position === 'QB' && w.severity === 'critical')).toBe(true)
    expect(res.floorRiskScore).toBeGreaterThan(0)
  })

  it('flags an injured starter', () => {
    const ctx = makeContext({ teams: [fullRoster('r1', true, { injuredRb: true })] })
    expect(evaluateRosterRisk(ctx, 'r1').injuredStarters.length).toBeGreaterThan(0)
  })
})

describe('guillotineLineupSafetyEngine', () => {
  it('plays a floor lineup when safe and surfaces a ceiling swing when at risk', () => {
    const safeCtx = makeContext({
      teams: [fullRoster('r1', true)],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'safe', rank: 8, pointsFromChopZone: 40 })],
    })
    const safe = evaluateLineupSafety(safeCtx, 'r1')
    expect(safe.posture).toBe('floor')
    expect(safe.ceilingSwing).toBeNull()

    const riskCtx = makeContext({
      teams: [fullRoster('r1', true)],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 })],
    })
    const risk = evaluateLineupSafety(riskCtx, 'r1')
    expect(risk.posture).toBe('ceiling_needed')
    expect(risk.ceilingSwing).not.toBeNull()
  })
})

// --- FAAB ---------------------------------------------------------------------

describe('guillotineFaabEngine', () => {
  it('is aggressive in the chop zone and conservative when safe', () => {
    const riskCtx = makeContext({ teams: [team({ rosterId: 'r1', isUserTeam: true, faabRemaining: 100 })], standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 })] })
    const aggressive = buildFaabPlan(riskCtx, 'r1')
    expect(aggressive.posture).toBe('aggressive')
    expect((aggressive.suggestedMaxBid ?? 0)).toBeGreaterThan(40)

    const safeCtx = makeContext({ teams: [team({ rosterId: 'r1', isUserTeam: true, faabRemaining: 100 })], standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'safe', rank: 8, pointsFromChopZone: 40 })] })
    const conservative = buildFaabPlan(safeCtx, 'r1')
    expect(conservative.posture).toBe('conserve')
    expect((conservative.suggestedMaxBid ?? 99)).toBeLessThan(aggressive.suggestedMaxBid ?? 0)
  })

  it('is qualitative when FAAB budget is unknown', () => {
    const ctx = makeContext({ teams: [team({ rosterId: 'r1', isUserTeam: true, faabRemaining: null })], standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'danger', rank: 2, pointsFromChopZone: 4 })], availability: { faab: 'missing' } })
    const plan = buildFaabPlan(ctx, 'r1')
    expect(plan.suggestedMaxBid).toBeNull()
  })
})

// --- waivers + dropped pool ---------------------------------------------------

describe('guillotineWaiverEngine', () => {
  it('high urgency in chop zone; targets weak positions; limited when no pool', () => {
    const ctx = makeContext({
      teams: [fullRoster('r1', true, { thinQb: true })],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 })],
    })
    const res = buildWaiverRecommendations(ctx, 'r1')
    expect(res.urgency).toBe('high')
    expect(res.targetPositions).toContain('QB')
    expect(res.needsPoolData).toBe(true)
    expect(res.recommendedAdds).toHaveLength(0)
  })

  it('uses the eliminated-team pool when present', () => {
    const ctx = makeContext({
      teams: [fullRoster('r1', true, { thinQb: true })],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'danger', rank: 2, pointsFromChopZone: 5 })],
      droppedPlayers: [
        { playerId: 'd-qb', playerName: 'Dropped QB', position: 'QB', team: 'BUF', fromEliminatedRosterId: 'rX', availableAt: null, adp: 25 },
        { playerId: 'd-wr', playerName: 'Dropped WR', position: 'WR', team: 'MIN', fromEliminatedRosterId: 'rX', availableAt: null, adp: 50 },
      ],
      availability: { droppedPlayerPool: 'available' },
    })
    const res = buildWaiverRecommendations(ctx, 'r1')
    expect(res.needsPoolData).toBe(false)
    expect(res.recommendedAdds[0].playerId).toBe('d-qb') // QB need first
    const dropped = evaluateDroppedPlayers(ctx, 'r1')
    expect(dropped.available).toBe(true)
    expect(dropped.targets.some((t) => t.position === 'QB' && t.atNeed)).toBe(true)
  })

  it('dropped-player engine is limited when no pool', () => {
    const ctx = makeContext({ teams: [fullRoster('r1', true)] })
    expect(evaluateDroppedPlayers(ctx, 'r1').available).toBe(false)
  })
})

// --- trade --------------------------------------------------------------------

describe('guillotineTradeEngine', () => {
  it('returns disabled when trades are off', () => {
    const ctx = makeContext({ teams: [fullRoster('r1', true)] })
    expect(analyzeGuillotineTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['r1-bench1'], incomingPlayerIds: [] }).verdict).toBe('disabled')
  })

  it('analyzes when trades are enabled', () => {
    const me = fullRoster('r1', true, { thinQb: true })
    const other = team({ rosterId: 'r2', players: [player({ playerId: 'oqb', position: 'QB', slotType: 'starter', weekProjection: 22, adp: 20 })] })
    const ctx = makeContext({ teams: [me, other], guillotine: { ...makeContext().guillotine, tradesEnabled: true } })
    const res = analyzeGuillotineTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['r1-bench1'], incomingPlayerIds: ['oqb'] })
    expect(res.verdict).not.toBe('disabled')
    expect(res.valueDelta).not.toBeNull()
    // 🛑 2026-09-29: the War Room's own value scale is not shown — the verdict is the one grade.
    expect([...res.explanationFacts, ...res.riskFlags, ...res.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('names no verdict when no player has a value signal', () => {
    const me = fullRoster('r1', true)
    const other = team({ rosterId: 'r2', players: [player({ playerId: 'nv', position: 'QB', slotType: 'starter' })] })
    const ctx = makeContext({ teams: [me, other], guillotine: { ...makeContext().guillotine, tradesEnabled: true } })
    const res = analyzeGuillotineTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: [], incomingPlayerIds: ['nv'] })
    expect(res.verdict).toBe('needs_more_data')
    expect([...res.explanationFacts, ...res.riskFlags, ...res.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })
})

// --- weekly plan + prompt -----------------------------------------------------

describe('guillotineWeeklyPlanEngine', () => {
  it('composes a survival-first plan with a chop-zone headline', () => {
    const ctx = makeContext({
      teams: [fullRoster('r1', true, { thinQb: true })],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'chop_zone', rank: 1, pointsFromChopZone: 0 })],
    })
    const plan = buildWeeklyPlan(ctx, 'r1')
    expect(plan.riskLevel).toBe('critical')
    expect(plan.headline.toUpperCase()).toContain('CHOP ZONE')
    expect(plan.steps.length).toBeGreaterThan(1)
  })
})

describe('guillotineWarRoomPrompt', () => {
  it('includes survival-first rules and no-fake-data rules', () => {
    expect(GUILLOTINE_WAR_ROOM_SYSTEM_RULES).toContain('Guillotine')
    expect(GUILLOTINE_WAR_ROOM_SYSTEM_RULES.toUpperCase()).toContain('SURVIVAL-FIRST')
    expect(GUILLOTINE_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('do not invent eliminated teams')
  })

  it('serializes context + engine outputs deterministically', () => {
    const ctx = makeContext({
      activeTeamCount: 8,
      teams: [fullRoster('r1', true)],
      standings: [standing({ rosterId: 'r1', isUserTeam: true, tier: 'danger', rank: 2, pointsFromChopZone: 6, seasonPointsCumul: 450 })],
    })
    const prompt = buildGuillotineWarRoomPrompt({
      context: ctx,
      survival: evaluateSurvivalRisk(ctx, 'r1'),
      rosterRisk: evaluateRosterRisk(ctx, 'r1'),
      faab: buildFaabPlan(ctx, 'r1'),
      weeklyPlan: buildWeeklyPlan(ctx, 'r1'),
    })
    expect(prompt).toContain('GUILLOTINE LEAGUE CONTEXT')
    expect(prompt).toContain('SURVIVAL STANDINGS')
    expect(prompt).toContain('DETERMINISTIC SURVIVAL RISK')
    expect(prompt).toContain('WEEKLY SURVIVAL PLAN')
  })
})
