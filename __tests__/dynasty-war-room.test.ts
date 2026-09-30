import { describe, expect, it } from 'vitest'
import { evaluateDynastyTeamNeeds } from '@/lib/dynasty-war-room/dynastyRosterNeedsEngine'
import { evaluateDynastyTeamDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import { evaluateBuySellHold } from '@/lib/dynasty-war-room/dynastyBuySellHoldEngine'
import { buildDynastyLineupRecommendation } from '@/lib/dynasty-war-room/dynastyLineupEngine'
import { buildDynastyWaiverRecommendations } from '@/lib/dynasty-war-room/dynastyWaiverEngine'
import { analyzeDynastyTrade, findDynastyTradeTargets } from '@/lib/dynasty-war-room/dynastyTradeEngine'
import { WAR_ROOM_PRIVATE_SCALE } from './war-room/warRoomPrivateScale'

/** Every line the dynasty War Room panel prints from a trade analysis. */
const dynastyShown = (r: ReturnType<typeof analyzeDynastyTrade>): string[] => [
  ...r.explanationFacts, ...r.ageImpact, ...r.pickImpact, ...(r.directionImpact ? [r.directionImpact] : []), ...r.riskFlags, ...r.missingDataFlags,
]
import { evaluateDynastyPickValue } from '@/lib/dynasty-war-room/dynastyPickValueEngine'
import {
  DYNASTY_WAR_ROOM_SYSTEM_RULES,
  buildDynastyWarRoomPrompt,
} from '@/lib/dynasty-war-room/dynastyWarRoomPrompt'
import { adpToDynastyValue, ageTrajectory, dynastyValue, pickHeuristicValue } from '@/lib/dynasty-war-room/dynastyPlayerValue'
import type {
  DynastyDataAvailability,
  DynastyFuturePick,
  DynastyPlayerFact,
  DynastyTeamSummary,
  DynastyWarRoomContext,
} from '@/lib/dynasty-war-room/types'

// --- fixture helpers ----------------------------------------------------------

// Mirrors the dynastyValue() contract: an explicit dynastyValue takes precedence,
// otherwise value is derived from ADP at read time (source 'adp'). The fixture
// keeps dynastyValue null when only ADP is supplied so the 'adp' path is exercised.
function player(p: Partial<DynastyPlayerFact> & { playerId: string; position: string }): DynastyPlayerFact {
  const adp = p.adp ?? null
  const dyn = p.dynastyValue ?? null
  return {
    playerId: p.playerId,
    playerName: p.playerName ?? `Player ${p.playerId}`,
    position: p.position,
    team: p.team ?? 'TM',
    slotType: p.slotType ?? 'bench',
    isStarterSlot: p.isStarterSlot ?? (p.slotType ? p.slotType === 'starter' : false),
    age: p.age ?? null,
    dynastyValue: dyn,
    adp,
    injuryStatus: p.injuryStatus ?? null,
    weekProjection: null,
    hasNoValueSignal: dyn == null && adp == null,
  }
}

const FULL_AVAILABILITY: DynastyDataAvailability = {
  scoringRules: 'available',
  rosterRules: 'available',
  standings: 'available',
  rosters: 'available',
  playerValues: 'available',
  playerAges: 'available',
  futurePicks: 'missing',
  injuries: 'available',
  news: 'available',
  projections: 'missing',
  freeAgentPool: 'available',
}

function team(over: Partial<DynastyTeamSummary> & { rosterId: string }): DynastyTeamSummary {
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
    picks: over.picks ?? [],
  }
}

function pick(
  p: Partial<DynastyFuturePick> & { id: string; season: number; round: number; currentOwnerId: string },
): DynastyFuturePick {
  const seasonsOut = p.season - 2026
  return {
    id: p.id,
    season: p.season,
    round: p.round,
    originalRosterId: p.originalRosterId ?? p.currentOwnerId,
    currentOwnerId: p.currentOwnerId,
    traded: p.traded ?? false,
    status: p.status ?? 'active',
    estValue: p.estValue ?? pickHeuristicValue(p.round, seasonsOut),
  }
}

function makeContext(over: Partial<DynastyWarRoomContext> = {}): DynastyWarRoomContext {
  const availability = { ...FULL_AVAILABILITY, ...(over.availability ?? {}) }
  // Strip the partial `availability` out of `over` so the trailing spread does not
  // clobber the carefully MERGED availability with a partial override.
  const { availability: _ignoredAvailability, featureAvailability: _ignoredFeature, ...restOver } = over
  return {
    leagueId: 'lg1',
    leagueType: 'dynasty',
    sport: 'NFL',
    season: 2026,
    scoring: { sport: 'NFL', scoringPreset: 'PPR', superflex: true, tePremium: false },
    roster: {
      totalStarterSlots: 9,
      benchSlots: 10,
      taxiSlots: 4,
      irSlots: 2,
      requiredByPosition: { QB: 1, RB: 2, WR: 3, TE: 1 },
    },
    userRosterId: 'r1',
    isCommissioner: false,
    teams: over.teams ?? [],
    freeAgents: over.freeAgents ?? [],
    rookieDraftWindows: over.rookieDraftWindows ?? [],
    availability,
    freshness: { generatedAt: new Date().toISOString(), valuesAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: {
      teamDirection: true,
      rosterNeeds: true,
      tradeAnalyze: true,
      tradeFind: true,
      buySellHold: true,
      waivers: true,
      lineup: true,
      pickValue: false,
      ...(over.featureAvailability ?? {}),
    },
    ...restOver,
  }
}

// A young, high-value contender roster.
function contenderRoster(): DynastyTeamSummary {
  return team({
    rosterId: 'r1',
    isUserTeam: true,
    wins: 8,
    losses: 2,
    pointsFor: 1400,
    players: [
      player({ playerId: 'qb1', position: 'QB', slotType: 'starter', age: 26, adp: 5 }),
      player({ playerId: 'rb1', position: 'RB', slotType: 'starter', age: 23, adp: 8 }),
      player({ playerId: 'rb2', position: 'RB', slotType: 'starter', age: 29, adp: 40 }),
      player({ playerId: 'wr1', position: 'WR', slotType: 'starter', age: 24, adp: 3 }),
      player({ playerId: 'wr2', position: 'WR', slotType: 'starter', age: 25, adp: 15 }),
      player({ playerId: 'wr3', position: 'WR', slotType: 'starter', age: 27, adp: 30 }),
      player({ playerId: 'te1', position: 'TE', slotType: 'starter', age: 28, adp: 35 }),
      player({ playerId: 'rb3', position: 'RB', slotType: 'bench', age: 22, adp: 60 }),
      player({ playerId: 'wr4', position: 'WR', slotType: 'bench', age: 21, adp: 70 }),
      player({ playerId: 'qb2', position: 'QB', slotType: 'taxi', age: 21, adp: 90 }),
    ],
  })
}

function rebuilderRoster(): DynastyTeamSummary {
  return team({
    rosterId: 'r2',
    wins: 2,
    losses: 8,
    pointsFor: 1050,
    players: [
      player({ playerId: 'q1', position: 'QB', slotType: 'starter', age: 35, adp: 50 }),
      player({ playerId: 'r1b', position: 'RB', slotType: 'starter', age: 30, adp: 45 }),
      player({ playerId: 'r2b', position: 'RB', slotType: 'starter', age: 31, adp: 80 }),
      player({ playerId: 'w1', position: 'WR', slotType: 'starter', age: 32, adp: 55 }),
      player({ playerId: 'w2', position: 'WR', slotType: 'starter', age: 22, adp: 20 }),
      player({ playerId: 'w3', position: 'WR', slotType: 'starter', age: 23, adp: 25 }),
      player({ playerId: 't1', position: 'TE', slotType: 'starter', age: 33, adp: 100 }),
    ],
  })
}

// --- value helpers ------------------------------------------------------------

describe('dynasty value + age helpers', () => {
  it('maps ADP to a positive, decreasing dynasty value', () => {
    expect(adpToDynastyValue(5)).toBeGreaterThan(adpToDynastyValue(50))
    expect(adpToDynastyValue(300)).toBe(0)
  })

  it('prefers explicit value over ADP and returns none when both missing', () => {
    expect(dynastyValue(player({ playerId: 'a', position: 'WR', dynastyValue: 42 })).source).toBe('value')
    expect(dynastyValue(player({ playerId: 'b', position: 'WR', adp: 10 })).source).toBe('adp')
    expect(dynastyValue(player({ playerId: 'c', position: 'WR' })).source).toBe('none')
  })

  it('applies position-specific age trajectories (RB cliffs earlier than QB)', () => {
    expect(ageTrajectory('RB', 28)).toBe('cliff')
    expect(ageTrajectory('QB', 28)).toBe('prime')
    expect(ageTrajectory('WR', 22)).toBe('ascending')
    expect(ageTrajectory('K', 25)).toBe('unknown')
    expect(ageTrajectory('WR', null)).toBe('unknown')
  })
})

// --- team direction -----------------------------------------------------------

describe('dynastyTeamDirectionEngine', () => {
  it('classifies a winning, value-rich roster as contending', () => {
    const ctx = makeContext({ teams: [contenderRoster()] })
    const res = evaluateDynastyTeamDirection(ctx, 'r1')
    expect(res.window).toBe('contend')
    expect(res.posture).toBe('buy_win_now')
    expect(res.contendScore).not.toBeNull()
    expect(res.avgStarterAge).toBeGreaterThan(0)
  })

  it('classifies a losing, aging roster as rebuilding', () => {
    const ctx = makeContext({ teams: [rebuilderRoster()] })
    const res = evaluateDynastyTeamDirection(ctx, 'r2')
    expect(res.window).toBe('rebuild')
    expect(res.posture).toBe('sell_for_youth')
  })

  it('returns unknown when no value or record signal exists', () => {
    const ctx = makeContext({
      teams: [team({ rosterId: 'r1', players: [player({ playerId: 'x', position: 'WR' })] })],
      availability: { playerValues: 'missing', standings: 'missing' },
    })
    const res = evaluateDynastyTeamDirection(ctx, 'r1')
    expect(res.window).toBe('unknown')
    expect(res.contendScore).toBeNull()
  })
})

// --- roster needs -------------------------------------------------------------

describe('dynastyRosterNeedsEngine', () => {
  it('flags a structural positional hole', () => {
    const ctx = makeContext({
      teams: [
        team({
          rosterId: 'r1',
          isUserTeam: true,
          players: [player({ playerId: 'qb1', position: 'QB', slotType: 'starter', age: 26, adp: 5 })],
        }),
      ],
    })
    const res = evaluateDynastyTeamNeeds(ctx, 'r1')
    // No RB/WR/TE → needs at those positions.
    expect(res.needs.some((n) => n.position === 'WR' && n.severity === 'critical')).toBe(true)
    expect(res.tradeTargetPositions).toContain('RB')
  })

  it('flags aging concentration as a weakness', () => {
    const ctx = makeContext({ teams: [rebuilderRoster()] })
    const res = evaluateDynastyTeamNeeds(ctx, 'r2')
    expect(res.weaknesses.some((w) => w.toLowerCase().includes('aging'))).toBe(true)
  })
})

// --- buy/sell/hold ------------------------------------------------------------

describe('dynastyBuySellHoldEngine', () => {
  it('recommends selling aging assets on a rebuild', () => {
    const ctx = makeContext({ teams: [rebuilderRoster()] })
    const res = evaluateBuySellHold(ctx, 'r2')
    expect(res.window).toBe('rebuild')
    const oldQb = res.entries.find((e) => e.playerId === 'q1')
    expect(oldQb?.call).toBe('sell')
  })

  it('holds by default and flags when no value signal exists', () => {
    const ctx = makeContext({
      teams: [team({ rosterId: 'r1', players: [player({ playerId: 'x', position: 'WR', age: 24 })] })],
      availability: { playerValues: 'missing' },
    })
    const res = evaluateBuySellHold(ctx, 'r1')
    expect(res.needsValueSignal).toBe(true)
    expect(res.entries.every((e) => e.call === 'hold')).toBe(true)
  })
})

// --- lineup -------------------------------------------------------------------

describe('dynastyLineupEngine', () => {
  it('fills required slots by value and excludes taxi/IR players, low confidence', () => {
    const ctx = makeContext({ teams: [contenderRoster()] })
    const res = buildDynastyLineupRecommendation(ctx, 'r1')
    expect(res.confidence).toBe('low')
    // taxi QB (qb2) must not be a starter
    expect(res.suggestedStarters.some((s) => s.playerId === 'qb2')).toBe(false)
    expect(res.suggestedStarters.filter((s) => s.position === 'WR').length).toBe(3)
  })
})

// --- waivers ------------------------------------------------------------------

describe('dynastyWaiverEngine', () => {
  it('ranks young free agents above older ones and lists drops', () => {
    const ctx = makeContext({
      teams: [contenderRoster()],
      freeAgents: [
        player({ playerId: 'fa-young', position: 'WR', slotType: 'free_agent', age: 22, adp: 65 }),
        player({ playerId: 'fa-old', position: 'WR', slotType: 'free_agent', age: 31, adp: 64 }),
      ],
    })
    const res = buildDynastyWaiverRecommendations(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(false)
    expect(res.recommendedAdds[0].playerId).toBe('fa-young')
    expect(res.recommendedDrops.length).toBeGreaterThan(0)
  })

  it('returns no invented adds when the pool is unavailable', () => {
    const ctx = makeContext({
      teams: [contenderRoster()],
      freeAgents: [],
      availability: { freeAgentPool: 'missing' },
    })
    const res = buildDynastyWaiverRecommendations(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(true)
    expect(res.recommendedAdds).toHaveLength(0)
    expect(res.recommendedDrops.length).toBeGreaterThan(0)
  })
})

// --- trade --------------------------------------------------------------------

describe('dynastyTradeEngine', () => {
  it('age-adjusts value: acquiring an ascending player for an aging one grades favorably', () => {
    const ctx = makeContext({ teams: [contenderRoster(), rebuilderRoster()] })
    const res = analyzeDynastyTrade(ctx, {
      rosterId: 'r1',
      outgoingPlayerIds: ['rb2'], // age 29 RB (cliff)
      incomingPlayerIds: ['w2'], // age 22 WR (ascending), on r2
    })
    expect(res.verdict).not.toBe('needs_more_data')
    expect(res.valueDelta).not.toBeNull()
    expect(res.ageImpact.length).toBeGreaterThan(0)
    // 🛑 2026-09-29: the War Room's own value scale is not shown — the verdict is the one grade.
    expect(dynastyShown(res).filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('flags picks as unpriced and needs_more_data without value', () => {
    const ctx = makeContext({
      teams: [team({ rosterId: 'r1', isUserTeam: true, players: [player({ playerId: 'np', position: 'WR' })] })],
      availability: { playerValues: 'missing', playerAges: 'missing' },
    })
    const res = analyzeDynastyTrade(ctx, {
      rosterId: 'r1',
      outgoingPlayerIds: ['np'],
      incomingPlayerIds: [],
      incomingPickIds: ['2027-1'],
    })
    expect(res.verdict).toBe('needs_more_data')
    expect(res.riskFlags.some((r) => r.toLowerCase().includes('pick'))).toBe(true)
    expect(dynastyShown(res).filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('matches a contender with a rebuilder in the trade finder', () => {
    const ctx = makeContext({ teams: [contenderRoster(), rebuilderRoster()] })
    const res = findDynastyTradeTargets(ctx, 'r1')
    expect(res.needsMoreData).toBe(false)
    const partner = res.targets.find((t) => t.rosterId === 'r2')
    expect(partner?.windowFit).toBeTruthy()
  })
})

// --- pick value (provider-limited) -------------------------------------------

describe('dynastyPickValueEngine', () => {
  it('reports provider integration needed when the table is missing', () => {
    const ctx = makeContext({ teams: [contenderRoster()] })
    const res = evaluateDynastyPickValue(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(true)
    expect(res.picks).toHaveLength(0)
    expect(res.totalEstValue).toBeNull()
  })

  it('reports an honest empty (not provider-limited) state when tracking is enabled but empty', () => {
    const ctx = makeContext({
      teams: [contenderRoster()],
      availability: { futurePicks: 'available_empty' },
    })
    const res = evaluateDynastyPickValue(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(false)
    expect(res.trackingEnabledEmpty).toBe(true)
    expect(res.picks).toHaveLength(0)
  })

  it('summarizes real picks (early count + total tier) when picks exist', () => {
    const team1 = contenderRoster()
    team1.picks = [
      pick({ id: 'p1', season: 2027, round: 1, currentOwnerId: 'r1' }),
      pick({ id: 'p2', season: 2027, round: 3, currentOwnerId: 'r1' }),
      pick({ id: 'p3', season: 2028, round: 2, currentOwnerId: 'r1', originalRosterId: 'r2', traded: true }),
    ]
    const ctx = makeContext({ teams: [team1], availability: { futurePicks: 'available' } })
    const res = evaluateDynastyPickValue(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(false)
    expect(res.picks).toHaveLength(3)
    expect(res.earlyPickCount).toBe(2) // R1 + R2
    expect(res.totalEstValue).toBeGreaterThan(0)
    // A traded-in pick is flagged as acquired, not original.
    expect(res.picks.find((p) => p.id === 'p3')?.fromOriginalOwner).toBe(false)
  })
})

// --- pick capital across engines ---------------------------------------------

describe('dynasty pick capital integration', () => {
  it('values picks via a deterministic structural tier (earlier round + nearer = higher)', () => {
    expect(pickHeuristicValue(1, 0)!).toBeGreaterThan(pickHeuristicValue(2, 0)!)
    expect(pickHeuristicValue(1, 0)!).toBeGreaterThan(pickHeuristicValue(1, 3)!)
    expect(pickHeuristicValue(null, 0)).toBeNull()
  })

  it('contender with weak pick capital is advised to spend picks to upgrade now', () => {
    const team1 = contenderRoster()
    team1.picks = [pick({ id: 'l1', season: 2028, round: 4, currentOwnerId: 'r1' })] // late only
    const ctx = makeContext({ teams: [team1], availability: { futurePicks: 'available' } })
    const bsh = evaluateBuySellHold(ctx, 'r1')
    expect(bsh.window).toBe('contend')
    expect(bsh.pickCapitalNote).toMatch(/no early picks|spend/i)
  })

  it('rebuilder with strong pick capital is told its pick capital is healthy', () => {
    const team2 = rebuilderRoster()
    team2.picks = [
      pick({ id: 'e1', season: 2027, round: 1, currentOwnerId: 'r2' }),
      pick({ id: 'e2', season: 2027, round: 2, currentOwnerId: 'r2' }),
      pick({ id: 'e3', season: 2028, round: 1, currentOwnerId: 'r2' }),
    ]
    const ctx = makeContext({ teams: [team2], userRosterId: 'r2', availability: { futurePicks: 'available' } })
    const dir = evaluateDynastyTeamDirection(ctx, 'r2')
    expect(dir.window).toBe('rebuild')
    expect(dir.earlyPickCount).toBe(3)
    expect(dir.pickCapitalValue).not.toBeNull()
    const bsh = evaluateBuySellHold(ctx, 'r2')
    expect(bsh.pickCapitalNote).toMatch(/healthy|accumulating/i)
  })

  it('prices picks inside a trade and excludes them when tracking is unavailable', () => {
    const c = contenderRoster()
    const r = rebuilderRoster()
    r.picks = [pick({ id: 'rp1', season: 2027, round: 1, currentOwnerId: 'r2' })]
    const ctx = makeContext({ teams: [c, r], availability: { futurePicks: 'available' } })
    const withPick = analyzeDynastyTrade(ctx, {
      rosterId: 'r1',
      outgoingPlayerIds: ['rb2'],
      incomingPlayerIds: [],
      incomingPickIds: ['rp1'],
    })
    expect(withPick.pickImpact.some((s) => s.includes('2027 R1'))).toBe(true)
    expect(withPick.valueDelta).not.toBeNull()
    expect(dynastyShown(withPick).filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])

    // Same pick id, but tracking unavailable → excluded + flagged, no crash.
    const ctxNoPicks = makeContext({ teams: [c, r], availability: { futurePicks: 'missing' } })
    const noPick = analyzeDynastyTrade(ctxNoPicks, {
      rosterId: 'r1',
      outgoingPlayerIds: ['rb2'],
      incomingPlayerIds: [],
      incomingPickIds: ['rp1'],
    })
    expect(noPick.riskFlags.some((s) => /not tracked/i.test(s))).toBe(true)
    expect(dynastyShown(noPick).filter((s) => WAR_ROOM_PRIVATE_SCALE.test(s))).toEqual([])
  })

  it('trade finder surfaces a pick angle between a contender and a pick-rich rebuilder', () => {
    const c = contenderRoster()
    const r = rebuilderRoster()
    r.picks = [
      pick({ id: 'rp1', season: 2027, round: 1, currentOwnerId: 'r2' }),
      pick({ id: 'rp2', season: 2027, round: 2, currentOwnerId: 'r2' }),
    ]
    const ctx = makeContext({ teams: [c, r], availability: { futurePicks: 'available' } })
    const res = findDynastyTradeTargets(ctx, 'r1')
    const partner = res.targets.find((t) => t.rosterId === 'r2')
    expect(partner?.reasons.some((s) => /pick/i.test(s))).toBe(true)
  })
})

// --- prompt -------------------------------------------------------------------

describe('dynastyWarRoomPrompt', () => {
  it('includes dynasty-only grounding rules and no redraft short-season framing', () => {
    expect(DYNASTY_WAR_ROOM_SYSTEM_RULES).toContain('DYNASTY')
    expect(DYNASTY_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('multi-year')
    expect(DYNASTY_WAR_ROOM_SYSTEM_RULES.toLowerCase()).toContain('never invent picks')
  })

  it('serializes context + engine outputs deterministically', () => {
    const ctx = makeContext({ teams: [contenderRoster()] })
    const prompt = buildDynastyWarRoomPrompt({
      context: ctx,
      direction: evaluateDynastyTeamDirection(ctx, 'r1'),
      needs: evaluateDynastyTeamNeeds(ctx, 'r1'),
      buySellHold: evaluateBuySellHold(ctx, 'r1'),
    })
    expect(prompt).toContain('DYNASTY LEAGUE CONTEXT')
    expect(prompt).toContain('DETERMINISTIC TEAM DIRECTION')
    expect(prompt).toContain('DETERMINISTIC BUY/SELL/HOLD')
  })
})
