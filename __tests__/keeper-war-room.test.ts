import { describe, expect, it } from 'vitest'
import { adpToValue, classifyKeeper, playerSeasonValue, rankKeepers } from '@/lib/keeper-war-room/keeperValueEngine'
import { recommendKeepers } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import { buildKeeperCutList } from '@/lib/keeper-war-room/keeperCutListEngine'
import { evaluateKeeperRosterNeeds } from '@/lib/keeper-war-room/keeperRosterNeedsEngine'
import { buildKeeperDraftPlan } from '@/lib/keeper-war-room/keeperDraftPlanEngine'
import { analyzeKeeperTrade } from '@/lib/keeper-war-room/keeperTradeEngine'
import { WAR_ROOM_PRIVATE_SCALE } from './war-room/warRoomPrivateScale'
import { findKeeperTradeTargets } from '@/lib/keeper-war-room/keeperTradeFinderEngine'
import { buildKeeperWaiverRecommendations } from '@/lib/keeper-war-room/keeperWaiverEngine'
import { buildKeeperLineupRecommendation } from '@/lib/keeper-war-room/keeperLineupEngine'
import { KEEPER_WAR_ROOM_SYSTEM_RULES, buildKeeperWarRoomPrompt } from '@/lib/keeper-war-room/keeperWarRoomPrompt'
import type {
  KeeperDataAvailability,
  KeeperPlayerFact,
  KeeperTeamSummary,
  KeeperWarRoomContext,
} from '@/lib/keeper-war-room/types'

// --- fixture helpers ----------------------------------------------------------

const TEAM_COUNT = 12

function player(
  p: Partial<KeeperPlayerFact> & { playerId: string; position: string },
): KeeperPlayerFact {
  const adp = p.adp ?? null
  const adpRound = p.adpRound ?? (adp != null ? Math.max(1, Math.ceil(adp / TEAM_COUNT)) : null)
  const keeperCostRound = p.keeperCostRound ?? null
  const surplusRounds =
    p.surplusRounds ?? (adpRound != null && keeperCostRound != null ? keeperCostRound - adpRound : null)
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? 'TM',
    slotType: p.slotType ?? 'bench',
    isStarterSlot: p.isStarterSlot ?? (p.slotType ? p.slotType !== 'bench' && p.slotType !== 'ir' && p.slotType !== 'free_agent' : false),
    isKept: p.isKept ?? false,
    injuryStatus: p.injuryStatus ?? null,
    adp,
    adpRound,
    isEligible: p.isEligible ?? true,
    ineligibleReason: p.ineligibleReason ?? null,
    yearsKept: p.yearsKept ?? 0,
    keeperCostRound,
    keeperCostAuction: p.keeperCostAuction ?? null,
    keeperCostLabel: p.keeperCostLabel ?? (keeperCostRound != null ? `Round ${keeperCostRound}` : null),
    surplusRounds,
    surplusAuction: p.surplusAuction ?? null,
    weekProjection: p.weekProjection ?? null,
    seasonAvgActual: p.seasonAvgActual ?? null,
  }
}

const FULL_AVAILABILITY: KeeperDataAvailability = {
  scoringRules: 'available',
  rosterRules: 'available',
  standings: 'available',
  schedule: 'available',
  rosters: 'available',
  playerValues: 'available',
  keeperRules: 'available',
  keeperCosts: 'available',
  eligibility: 'available',
  projections: 'missing',
  injuries: 'available',
  news: 'available',
  freeAgentPool: 'available',
}

function team(over: Partial<KeeperTeamSummary> & { rosterId: string }): KeeperTeamSummary {
  return {
    rosterId: over.rosterId,
    ownerId: over.ownerId ?? `owner-${over.rosterId}`,
    ownerName: over.ownerName ?? `Owner ${over.rosterId}`,
    teamName: over.teamName ?? `Team ${over.rosterId}`,
    wins: over.wins ?? 0,
    losses: over.losses ?? 0,
    ties: over.ties ?? 0,
    pointsFor: over.pointsFor ?? 0,
    pointsAgainst: over.pointsAgainst ?? 0,
    playoffSeed: over.playoffSeed ?? null,
    isEliminated: over.isEliminated ?? false,
    isUserTeam: over.isUserTeam ?? false,
    players: over.players ?? [],
  }
}

function makeContext(over: Partial<KeeperWarRoomContext> = {}): KeeperWarRoomContext {
  const availability = { ...FULL_AVAILABILITY, ...(over.availability ?? {}) }
  const { availability: _a, featureAvailability: _f, ...rest } = over
  const adpAvailable = availability.playerValues === 'available'
  const costAvailable = availability.keeperCosts === 'available'
  return {
    leagueId: 'lg1',
    leagueType: 'keeper',
    sport: 'NFL',
    season: 2026,
    teamCount: TEAM_COUNT,
    currentWeek: 0,
    totalWeeks: 17,
    seasonStatus: 'pre_draft',
    seasonActive: false,
    scoring: { sport: 'NFL', scoringPreset: 'PPR', pointsPerReception: 1, superflex: false, tePremium: false },
    roster: { totalStarterSlots: 7, benchSlots: 6, irSlots: 1, requiredByPosition: { QB: 1, RB: 3, WR: 3, TE: 1 } },
    keeper: {
      maxKeepers: 3,
      maxYears: 3,
      costSystem: 'round_based',
      roundPenalty: 1,
      auctionPctIncrease: 0.2,
      waiverAllowed: true,
      selectionDeadline: null,
      keeperPhaseActive: true,
      draftRounds: 13,
    },
    userRosterId: 'r1',
    isCommissioner: false,
    teams: over.teams ?? [],
    freeAgents: over.freeAgents ?? [],
    availability,
    freshness: { generatedAt: new Date().toISOString(), statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: {
      keeperRecommendations: adpAvailable && costAvailable,
      cutList: adpAvailable,
      rosterNeeds: true,
      draftPlan: true,
      tradeAnalyze: true,
      tradeFind: adpAvailable,
      waivers: false,
      lineup: false,
      ...(over.featureAvailability ?? {}),
    },
    ...rest,
  }
}

// A roster mixing great-value, fair, and negative-value keepers + an ineligible one.
function userRoster(): KeeperTeamSummary {
  return team({
    rosterId: 'r1',
    isUserTeam: true,
    players: [
      // Round 2 ADP player keepable at Round 8 → +6 surplus (elite keep).
      player({ playerId: 'steal', position: 'WR', slotType: 'WR', adp: 20, keeperCostRound: 8 }),
      // Round 3 ADP keepable at Round 5 → +2 (strong keep).
      player({ playerId: 'good', position: 'RB', slotType: 'RB', adp: 32, keeperCostRound: 5 }),
      // Round 4 ADP keepable at Round 4 → 0 (borderline).
      player({ playerId: 'fair', position: 'RB', slotType: 'RB', adp: 44, keeperCostRound: 4 }),
      // Round 2 ADP but costs Round 1 → -1 (let go).
      player({ playerId: 'pricey', position: 'QB', slotType: 'QB', adp: 18, keeperCostRound: 1 }),
      // Ineligible (max years).
      player({ playerId: 'maxed', position: 'TE', slotType: 'TE', adp: 30, keeperCostRound: 6, isEligible: false, ineligibleReason: 'max_years_reached' }),
      // No cost recorded.
      player({ playerId: 'nocost', position: 'WR', slotType: 'bench', adp: 60 }),
    ],
  })
}

// --- value helpers ------------------------------------------------------------

describe('keeper value helpers', () => {
  it('maps ADP to a positive, decreasing value', () => {
    expect(adpToValue(10)).toBeGreaterThan(adpToValue(100))
    expect(adpToValue(300)).toBe(0)
  })

  it('season value prefers projection → season avg → ADP', () => {
    expect(playerSeasonValue(player({ playerId: 'a', position: 'WR', weekProjection: 15 })).source).toBe('projection')
    expect(playerSeasonValue(player({ playerId: 'b', position: 'WR', seasonAvgActual: 12 })).source).toBe('season_avg')
    expect(playerSeasonValue(player({ playerId: 'c', position: 'WR', adp: 30 })).source).toBe('adp')
    expect(playerSeasonValue(player({ playerId: 'd', position: 'WR' })).source).toBe('none')
  })

  it('classifies a high-value low-cost keeper as a definite keep and a pricey one as let_go', () => {
    expect(classifyKeeper(player({ playerId: 'steal', position: 'WR', adp: 20, keeperCostRound: 8 })).verdict).toBe('definite_keep')
    expect(classifyKeeper(player({ playerId: 'pricey', position: 'QB', adp: 18, keeperCostRound: 1 })).verdict).toBe('let_go')
  })

  it('flags ineligible and no-cost players honestly', () => {
    expect(classifyKeeper(player({ playerId: 'x', position: 'TE', isEligible: false, ineligibleReason: 'max_years_reached' })).verdict).toBe('ineligible')
    expect(classifyKeeper(player({ playerId: 'y', position: 'WR', adp: 60 })).verdict).toBe('no_cost')
  })
})

// --- recommendations ----------------------------------------------------------

describe('keeperRecommendationEngine', () => {
  it('recommends the best keepers within the limit, surfaces bubble + avoid', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const res = recommendKeepers(ctx, 'r1')
    expect(res.needsMoreData).toBe(false)
    expect(res.recommended.map((r) => r.playerId)).toEqual(['steal', 'good', 'fair'])
    // pricey (negative) is in avoid; ineligible + no-cost are excluded from keepable.
    expect(res.avoid.some((r) => r.playerId === 'pricey')).toBe(true)
    expect(res.recommended.some((r) => r.playerId === 'maxed')).toBe(false)
  })

  it('returns a limited-data state when keeper costs are missing', () => {
    const ctx = makeContext({
      teams: [userRoster()],
      availability: { keeperCosts: 'missing' },
    })
    const res = recommendKeepers(ctx, 'r1')
    expect(res.needsMoreData).toBe(true)
    expect(res.recommended).toHaveLength(0)
  })

  it('keeper limit forces a cut: more positive keepers than slots', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const cut = buildKeeperCutList(ctx, 'r1')
    // 3 positive-value eligible keepers (steal/good/fair) == limit 3; pricey is negative → cut.
    expect(cut.cutList.some((c) => c.playerId === 'pricey')).toBe(true)
    expect(cut.cutList.some((c) => c.playerId === 'maxed')).toBe(true)
  })

  it('round penalty changes derived value (deeper cost round = more surplus)', () => {
    const cheap = classifyKeeper(player({ playerId: 'z', position: 'WR', adp: 20, keeperCostRound: 10 }))
    const expensive = classifyKeeper(player({ playerId: 'z', position: 'WR', adp: 20, keeperCostRound: 3 }))
    expect((cheap.surplusRounds ?? 0)).toBeGreaterThan(expensive.surplusRounds ?? 0)
  })
})

// --- needs + draft plan -------------------------------------------------------

describe('keeperRosterNeedsEngine + draftPlanEngine', () => {
  it('computes roster needs AFTER the keep set and a draft plan that skips consumed rounds', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const needs = evaluateKeeperRosterNeeds(ctx, 'r1')
    // Kept set = steal(WR), good(RB), fair(RB). Required WR:3 → need 2 more WR; RB:3 → need 1; QB:1, TE:1 → need.
    expect(needs.draftTargetPositions).toContain('QB')
    expect(needs.draftTargetPositions).toContain('TE')

    const plan = buildKeeperDraftPlan(ctx, 'r1')
    // steal costs R8, good R5, fair R4 → those rounds consumed.
    expect(plan.consumedRounds).toEqual([4, 5, 8])
    expect(plan.remainingRounds).not.toContain(8)
    expect(plan.roundPlan.length).toBeGreaterThan(0)
  })

  it('draft plan notes auction systems do not consume rounds', () => {
    const ctx = makeContext({
      teams: [userRoster()],
      keeper: { ...makeContext().keeper, costSystem: 'auction_value' },
    })
    const plan = buildKeeperDraftPlan(ctx, 'r1')
    expect(plan.consumedRounds).toHaveLength(0)
    expect(plan.explanationFacts.join(' ')).toMatch(/auction/i)
  })
})

// --- trade --------------------------------------------------------------------

describe('keeperTradeEngine + finder', () => {
  it('accounts for keeper surplus: acquiring a strong keeper boosts the verdict', () => {
    const me = userRoster()
    const other = team({
      rosterId: 'r2',
      players: [player({ playerId: 'targetKeeper', position: 'WR', slotType: 'WR', adp: 15, keeperCostRound: 9 })],
    })
    const ctx = makeContext({ teams: [me, other] })
    const res = analyzeKeeperTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['fair'], incomingPlayerIds: ['targetKeeper'] })
    expect(res.verdict).not.toBe('needs_more_data')
    expect(res.keeperImpact.some((s) => s.includes('targetKeeper'))).toBe(true)
    // 🛑 2026-09-29: the War Room's own value scale is not shown — the verdict is the one grade.
    expect([...res.explanationFacts, ...res.keeperImpact, ...res.riskFlags, ...res.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('returns needs_more_data when no value signal exists', () => {
    const ctx = makeContext({
      teams: [team({ rosterId: 'r1', isUserTeam: true, players: [player({ playerId: 'np', position: 'WR' })] })],
      availability: { playerValues: 'missing', keeperCosts: 'missing' },
    })
    const res = analyzeKeeperTrade(ctx, { rosterId: 'r1', outgoingPlayerIds: ['np'], incomingPlayerIds: [] })
    expect(res.verdict).toBe('needs_more_data')
    expect([...res.explanationFacts, ...res.riskFlags, ...res.missingDataFlags].filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('trade finder matches surplus-keeper teams with needy teams', () => {
    // r1 has surplus WR keepers (4 positive WR keepers vs limit 3); r2 needs WR.
    const me = team({
      rosterId: 'r1',
      isUserTeam: true,
      players: [
        player({ playerId: 'w1', position: 'WR', slotType: 'WR', adp: 10, keeperCostRound: 9 }),
        player({ playerId: 'w2', position: 'WR', slotType: 'WR', adp: 14, keeperCostRound: 9 }),
        player({ playerId: 'w3', position: 'WR', slotType: 'WR', adp: 18, keeperCostRound: 9 }),
        player({ playerId: 'w4', position: 'WR', slotType: 'bench', adp: 22, keeperCostRound: 9 }),
        player({ playerId: 'q1', position: 'QB', slotType: 'QB', adp: 8, keeperCostRound: 10 }),
        player({ playerId: 'r1b', position: 'RB', slotType: 'RB', adp: 30, keeperCostRound: 8 }),
        player({ playerId: 'r1c', position: 'RB', slotType: 'RB', adp: 34, keeperCostRound: 8 }),
        player({ playerId: 't1', position: 'TE', slotType: 'TE', adp: 40, keeperCostRound: 9 }),
      ],
    })
    const other = team({
      rosterId: 'r2',
      players: [player({ playerId: 'oq', position: 'QB', slotType: 'QB', adp: 9, keeperCostRound: 10 })],
    })
    const ctx = makeContext({ teams: [me, other] })
    const res = findKeeperTradeTargets(ctx, 'r1')
    expect(res.needsMoreData).toBe(false)
    expect(res.targets.some((t) => t.rosterId === 'r2')).toBe(true)
  })
})

// --- waivers/lineup (season inactive) -----------------------------------------

describe('keeperWaiverEngine + lineupEngine (pre-season)', () => {
  it('waivers and lineup are not in play before the season is active', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const w = buildKeeperWaiverRecommendations(ctx, 'r1')
    expect(w.needsProviderIntegration).toBe(true)
    expect(w.recommendedAdds).toHaveLength(0)
    const l = buildKeeperLineupRecommendation(ctx, 'r1')
    expect(l.active).toBe(false)
  })

  it('lineup fills slots by value when the season is active', () => {
    const me = team({
      rosterId: 'r1',
      isUserTeam: true,
      players: [
        player({ playerId: 'qb', position: 'QB', slotType: 'QB', weekProjection: 22 }),
        player({ playerId: 'rb1', position: 'RB', slotType: 'RB', weekProjection: 16 }),
        player({ playerId: 'rb2', position: 'RB', slotType: 'RB', weekProjection: 12 }),
        player({ playerId: 'rb3', position: 'RB', slotType: 'bench', weekProjection: 9 }),
        player({ playerId: 'wr1', position: 'WR', slotType: 'WR', weekProjection: 15 }),
        player({ playerId: 'wr2', position: 'WR', slotType: 'WR', weekProjection: 13 }),
        player({ playerId: 'wr3', position: 'WR', slotType: 'WR', weekProjection: 10 }),
        player({ playerId: 'te', position: 'TE', slotType: 'TE', weekProjection: 8 }),
      ],
    })
    const ctx = makeContext({ teams: [me], seasonActive: true, availability: { projections: 'available' } })
    const l = buildKeeperLineupRecommendation(ctx, 'r1')
    expect(l.active).toBe(true)
    expect(l.confidence).toBe('high')
    expect(l.suggestedStarters.filter((s) => s.position === 'RB').length).toBe(3)
  })
})

// --- prompt -------------------------------------------------------------------

describe('keeperWarRoomPrompt', () => {
  it('includes keeper-only grounding rules (cost/surplus/limit; no future picks)', () => {
    expect(KEEPER_WAR_ROOM_SYSTEM_RULES).toContain('KEEPER')
    expect(KEEPER_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('surplus')
    expect(KEEPER_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('do not use dynasty future-pick')
    expect(KEEPER_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('do not invent keeper costs')
  })

  it('serializes keeper context + engine outputs deterministically', () => {
    const ctx = makeContext({ teams: [userRoster()] })
    const prompt = buildKeeperWarRoomPrompt({
      context: ctx,
      recommendations: recommendKeepers(ctx, 'r1'),
      cutList: buildKeeperCutList(ctx, 'r1'),
      needs: evaluateKeeperRosterNeeds(ctx, 'r1'),
      draftPlan: buildKeeperDraftPlan(ctx, 'r1'),
    })
    expect(prompt).toContain('KEEPER LEAGUE CONTEXT')
    expect(prompt).toContain('DETERMINISTIC KEEPER RECOMMENDATIONS')
    expect(prompt).toContain('DRAFT PLAN AFTER KEEPERS')
  })
})
