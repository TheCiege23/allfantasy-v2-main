import { describe, expect, it } from 'vitest'
import {
  evaluateTeamNeeds,
  evaluateUserTeamNeeds,
} from '@/lib/redraft-war-room/redraftTeamNeedsEngine'
import { buildLineupRecommendation } from '@/lib/redraft-war-room/redraftLineupEngine'
import { buildWaiverRecommendations } from '@/lib/redraft-war-room/redraftWaiverEngine'
import { redraftTradeFacts, findTradeTargets } from '@/lib/redraft-war-room/redraftTradeEngine'
import { warRoomLegacyVerdict } from '@/lib/decision-os/trade/warRoomLegacyVerdict'
import { WAR_ROOM_PRIVATE_SCALE } from './war-room/warRoomPrivateScale'
import {
  REDRAFT_WAR_ROOM_SYSTEM_RULES,
  buildRedraftWarRoomPrompt,
} from '@/lib/redraft-war-room/redraftWarRoomPrompt'
import type {
  RedraftDataAvailability,
  RedraftPlayerFact,
  RedraftWarRoomContext,
} from '@/lib/redraft-war-room/types'

// --- fixture helpers ----------------------------------------------------------

function player(p: Partial<RedraftPlayerFact> & { playerId: string; position: string }): RedraftPlayerFact {
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? 'TM',
    slotType: p.slotType ?? 'bench',
    isStarterSlot: p.isStarterSlot ?? p.slotType !== 'bench',
    injuryStatus: p.injuryStatus ?? null,
    byeWeek: p.byeWeek ?? null,
    weekProjection: p.weekProjection ?? null,
    seasonAvgActual: p.seasonAvgActual ?? null,
    adp: p.adp ?? null,
    hasNoValueSignal: p.weekProjection == null && p.seasonAvgActual == null && (p.adp ?? null) == null,
  }
}

const FULL_AVAILABILITY: RedraftDataAvailability = {
  scoringRules: 'available',
  rosterRules: 'available',
  standings: 'available',
  schedule: 'available',
  playerStats: 'available',
  projections: 'available',
  injuries: 'available',
  news: 'available',
  waiverPool: 'missing',
  tradeValues: 'available',
}

function makeContext(over: Partial<RedraftWarRoomContext> = {}): RedraftWarRoomContext {
  const availability = { ...FULL_AVAILABILITY, ...(over.availability ?? {}) }
  return {
    leagueId: 'lg1',
    leagueType: 'redraft',
    sport: 'NFL',
    season: 2026,
    currentWeek: 6,
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
      totalStarterSlots: 7,
      benchSlots: 6,
      irSlots: 1,
      lineupSlots: [
        { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, isFlex: false, isSuperflex: false },
        { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, isFlex: false, isSuperflex: false },
        { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, isFlex: true, isSuperflex: false },
      ],
      requiredByPosition: { QB: 1, RB: 3, WR: 3, TE: 2 },
    },
    waivers: { type: 'faab', faabBudget: 100 },
    userRosterId: 'r1',
    isCommissioner: false,
    teams: over.teams ?? [],
    upcomingMatchup: null,
    recentMatchup: null,
    freeAgents: [],
    availability,
    freshness: { generatedAt: 'now', statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: {
      teamNeeds: true,
      lineup: true,
      waivers: availability.waiverPool === 'available',
      tradeAnalyze: true,
      tradeFind: true,
    },
    ...over,
  }
}

function teamWith(rosterId: string, players: RedraftPlayerFact[], isUser = false) {
  return {
    rosterId,
    ownerId: rosterId,
    ownerName: `Owner ${rosterId}`,
    teamName: `Team ${rosterId}`,
    wins: 3,
    losses: 2,
    ties: 0,
    pointsFor: 600,
    pointsAgainst: 560,
    streak: 'W1',
    playoffSeed: 4,
    faabBalance: 80,
    waiverPriority: 5,
    isEliminated: false,
    isUserTeam: isUser,
    players,
  }
}

// A roster missing a starting QB and thin at RB, with a strong WR room.
function weakRoster(): RedraftPlayerFact[] {
  return [
    player({ playerId: 'rb1', position: 'RB', slotType: 'RB', isStarterSlot: true, weekProjection: 12 }),
    player({ playerId: 'wr1', position: 'WR', slotType: 'WR', isStarterSlot: true, weekProjection: 18 }),
    player({ playerId: 'wr2', position: 'WR', slotType: 'WR', isStarterSlot: true, weekProjection: 15 }),
    player({ playerId: 'wr3', position: 'WR', slotType: 'bench', weekProjection: 11 }),
    player({ playerId: 'wr4', position: 'WR', slotType: 'bench', weekProjection: 9 }),
    player({ playerId: 'te1', position: 'TE', slotType: 'TE', isStarterSlot: true, weekProjection: 8 }),
  ]
}

// --- team needs ---------------------------------------------------------------

describe('redraftTeamNeedsEngine', () => {
  it('detects a critical hole at QB and depth need at RB; flags WR strength', () => {
    const ctx = makeContext({ teams: [teamWith('r1', weakRoster(), true)] })
    const result = evaluateTeamNeeds(ctx, 'r1')
    const qbNeed = result.needs.find((n) => n.position === 'QB')
    expect(qbNeed?.severity).toBe('critical')
    expect(result.tradeTargetPositions).toContain('QB')
    expect(result.tradeTargetPositions).toContain('RB')
    expect(result.strengths.some((s) => s.startsWith('WR'))).toBe(true)
    expect(result.urgencyScore).toBeGreaterThan(0)
  })

  it('returns structural-only flag when no value signal exists', () => {
    const noValue = weakRoster().map((p) => ({
      ...p,
      weekProjection: null,
      seasonAvgActual: null,
      adp: null,
      hasNoValueSignal: true,
    }))
    const ctx = makeContext({
      teams: [teamWith('r1', noValue, true)],
      availability: { ...FULL_AVAILABILITY, projections: 'missing', playerStats: 'missing', tradeValues: 'missing' },
    })
    const result = evaluateTeamNeeds(ctx, 'r1')
    expect(result.missingDataFlags.some((f) => /structural only|no projection/i.test(f))).toBe(true)
  })

  it('evaluateUserTeamNeeds returns null when the viewer has no team', () => {
    const ctx = makeContext({ userRosterId: null, teams: [] })
    expect(evaluateUserTeamNeeds(ctx)).toBeNull()
  })
})

// --- lineup -------------------------------------------------------------------

describe('redraftLineupEngine', () => {
  it('respects dedicated slots and fills FLEX from leftovers', () => {
    const ctx = makeContext({ teams: [teamWith('r1', weakRoster(), true)] })
    const result = buildLineupRecommendation(ctx, 'r1')
    const flex = result.suggestedStarters.find((s) => s.slotName === 'FLEX')
    // FLEX should be filled by a leftover RB/WR/TE (the 3rd-best WR here).
    expect(flex?.playerId).toBeTruthy()
    // QB slot has no eligible player → empty, not fabricated.
    const qb = result.suggestedStarters.find((s) => s.slotName === 'QB')
    expect(qb?.playerId).toBeNull()
    expect(result.confidence).toBe('high') // projections available
  })

  it('flags low confidence and structural placement when projections/stats are missing', () => {
    const noValue = weakRoster().map((p) => ({ ...p, weekProjection: null, seasonAvgActual: null, hasNoValueSignal: true }))
    const ctx = makeContext({
      teams: [teamWith('r1', noValue, true)],
      availability: { ...FULL_AVAILABILITY, projections: 'missing', playerStats: 'missing' },
    })
    const result = buildLineupRecommendation(ctx, 'r1')
    expect(result.confidence).toBe('none')
    expect(result.missingDataFlags.some((f) => /structural only/i.test(f))).toBe(true)
    expect(result.projectedStartersPoints).toBeNull()
  })
})

// --- waivers ------------------------------------------------------------------

describe('redraftWaiverEngine', () => {
  it('returns drop-side analysis and a needs-provider flag when the free-agent pool is missing', () => {
    const ctx = makeContext({ teams: [teamWith('r1', weakRoster(), true)] })
    const result = buildWaiverRecommendations(ctx, 'r1')
    expect(result.needsProviderIntegration).toBe(true)
    expect(result.recommendedAdds).toHaveLength(0)
    expect(result.recommendedDrops.length).toBeGreaterThan(0)
    expect(result.missingDataFlags.some((f) => /free-agent pool/i.test(f))).toBe(true)
    expect(result.targetPositions).toContain('QB')
  })

  it('recommends adds from the pool when waiverPool is available', () => {
    const ctx = makeContext({
      teams: [teamWith('r1', weakRoster(), true)],
      availability: { ...FULL_AVAILABILITY, waiverPool: 'available' },
      freeAgents: [
        player({ playerId: 'qbFA', position: 'QB', weekProjection: 17 }),
        player({ playerId: 'kFA', position: 'K', weekProjection: 8 }),
      ],
    })
    const result = buildWaiverRecommendations(ctx, 'r1')
    expect(result.needsProviderIntegration).toBe(false)
    expect(result.recommendedAdds.some((a) => a.position === 'QB')).toBe(true)
    // FAAB suggestion present when budget known.
    expect(result.recommendedAdds[0].faabBidSuggestion).not.toBeNull()
  })

  it('Step 3D: each add carries a tier, confidence, explanation, and FAAB band', () => {
    const ctx = makeContext({
      teams: [teamWith('r1', weakRoster(), true)],
      availability: { ...FULL_AVAILABILITY, waiverPool: 'available' },
      freeAgents: [
        player({ playerId: 'qbFA', position: 'QB', weekProjection: 24 }), // fills QB hole, strong proj
        player({ playerId: 'kFA', position: 'K', weekProjection: 6 }),
      ],
    })
    const result = buildWaiverRecommendations(ctx, 'r1')
    const add = result.recommendedAdds.find((a) => a.position === 'QB')!
    expect(add).toBeTruthy()
    expect(add.recommendationScore).toBeGreaterThan(0)
    expect(add.confidence).toBeGreaterThan(0)
    expect(['high', 'medium', 'low']).toContain(add.confidenceLevel)
    expect(['Must Add', 'Strong Add', 'Worth Considering', 'Watch List', 'Low Priority']).toContain(add.tier)
    expect(add.explanation.length).toBeGreaterThan(0)
    // FAAB league (default fixture) → a band is present.
    expect(add.faabBand).not.toBeNull()
  })

  it('Step 3D: NCAAF / missing projections reduce confidence and never block recs', () => {
    const ctx = makeContext({
      sport: 'NCAAF',
      teams: [teamWith('r1', weakRoster(), true)],
      availability: { ...FULL_AVAILABILITY, waiverPool: 'available', projections: 'missing' },
      freeAgents: [player({ playerId: 'rbFA', position: 'RB', adp: 40 })],
    })
    const result = buildWaiverRecommendations(ctx, 'r1')
    const add = result.recommendedAdds[0]
    expect(add).toBeTruthy()
    expect(add.confidenceLevel === 'low' || add.confidence < 60).toBe(true)
    expect(add.explanation.some((e) => /limited data/i.test(e))).toBe(true)
  })
})

// --- trades -------------------------------------------------------------------

describe('redraftTradeEngine', () => {
  it('analyzes a proposed trade and accepts a clear value + fit gain', () => {
    const roster = weakRoster()
    const ctx = makeContext({
      teams: [
        teamWith('r1', roster, true),
        teamWith('r2', [player({ playerId: 'qbX', position: 'QB', weekProjection: 22 })]),
      ],
    })
    const result = redraftTradeFacts(ctx, {
      rosterId: 'r1',
      outgoingPlayerIds: ['wr3'], // bench WR (proj 11)
      incomingPlayerIds: ['qbX'], // fills the QB hole (proj 22)
    })
    // 🛑 2026-09-30: facts, never a verdict — the retired rule reads these inputs, for the shadow only.
    expect(result).not.toHaveProperty('verdict')
    expect(warRoomLegacyVerdict(result)).toBe('accept')
    expect(result.valueDelta).toBeGreaterThan(0)
    expect(result.lineupImpact.some((s) => /QB need/i.test(s))).toBe(true)
    // 🛑 2026-09-29: the War Room's own value scale is not shown — the verdict is the one grade.
    const shown = [...result.explanationFacts, ...result.lineupImpact, ...result.benchImpact, ...result.riskFlags, ...result.missingDataFlags]
    expect(shown.filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('returns needs_more_data when no value signal exists for the players', () => {
    const ctx = makeContext({
      teams: [
        teamWith('r1', [player({ playerId: 'a', position: 'RB' })], true),
        teamWith('r2', [player({ playerId: 'b', position: 'RB' })]),
      ],
      availability: { ...FULL_AVAILABILITY, projections: 'missing', playerStats: 'missing', tradeValues: 'missing' },
    })
    const result = redraftTradeFacts(ctx, { rosterId: 'r1', outgoingPlayerIds: ['a'], incomingPlayerIds: ['b'] })
    expect(result).not.toHaveProperty('verdict')
    expect(warRoomLegacyVerdict(result)).toBe('needs_more_data')
    expect(result.valueDelta).toBeNull()
    expect(result.missingDataFlags.some((s) => /no projection\/stat signal/i.test(s))).toBe(true)
    expect([...result.explanationFacts, ...result.riskFlags, ...result.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('positive control: the private-scale shape matches the lines the engine printed', () => {
    expect(WAR_ROOM_PRIVATE_SCALE.test('Value in 22.0 vs value out 11.0 (delta +11).')).toBe(true)
    expect(WAR_ROOM_PRIVATE_SCALE.test('No projection/stat signal for the involved players — value verdict unavailable.')).toBe(true)
    expect(WAR_ROOM_PRIVATE_SCALE.test('Some players lack a value signal — verdict weighted by available data only.')).toBe(true)
    expect(WAR_ROOM_PRIVATE_SCALE.test('Incoming Josh Allen addresses QB need.')).toBe(false)
  })

  it('trade finder needs value data, and finds complementary partners when present', () => {
    // r1 needs QB, deep at WR. r2 is deep at QB, needs WR.
    const r1 = weakRoster()
    const r2 = [
      player({ playerId: 'q1', position: 'QB', slotType: 'QB', isStarterSlot: true, weekProjection: 20 }),
      player({ playerId: 'q2', position: 'QB', weekProjection: 16 }),
      player({ playerId: 'q3', position: 'QB', weekProjection: 14 }),
      player({ playerId: 'r2rb', position: 'RB', slotType: 'RB', isStarterSlot: true, weekProjection: 13 }),
    ]
    const ctx = makeContext({ teams: [teamWith('r1', r1, true), teamWith('r2', r2)] })
    const result = findTradeTargets(ctx, 'r1')
    expect(result.needsMoreData).toBe(false)
    expect(result.targets[0]?.rosterId).toBe('r2')
    expect(result.targets[0]?.theySupply).toContain('QB')

    const noData = makeContext({
      teams: [teamWith('r1', r1, true)],
      availability: { ...FULL_AVAILABILITY, projections: 'missing', playerStats: 'missing', tradeValues: 'missing' },
    })
    expect(findTradeTargets(noData, 'r1').needsMoreData).toBe(true)
  })
})

// --- prompt grounding ---------------------------------------------------------

describe('redraftWarRoomPrompt', () => {
  it('system rules forbid invention and enforce redraft framing', () => {
    expect(REDRAFT_WAR_ROOM_SYSTEM_RULES).toMatch(/do not invent/i)
    expect(REDRAFT_WAR_ROOM_SYSTEM_RULES).toMatch(/redraft/i)
    expect(REDRAFT_WAR_ROOM_SYSTEM_RULES).toMatch(/dynasty|future draft picks|taxi|devy/i)
  })

  it('includes data availability, missing-data flags, and deterministic facts', () => {
    const ctx = makeContext({
      teams: [teamWith('r1', weakRoster(), true)],
      missingDataFlags: ['Free-agent pool requires provider integration.'],
    })
    const needs = evaluateTeamNeeds(ctx, 'r1')
    const prompt = buildRedraftWarRoomPrompt({ context: ctx, needs, question: 'Who should I start?' })
    expect(prompt).toMatch(/DATA AVAILABILITY/)
    expect(prompt).toMatch(/MISSING-DATA FLAGS/)
    expect(prompt).toMatch(/provider integration/)
    expect(prompt).toMatch(/DETERMINISTIC TEAM NEEDS/)
    expect(prompt).toMatch(/Who should I start\?/)
  })
})
