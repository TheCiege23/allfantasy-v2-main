import { describe, expect, it } from 'vitest'
import { adpToValue, confidenceForSource, playerValue } from '@/lib/redraft-war-room/playerValue'
import { rosteredPlayerKeys } from '@/lib/redraft-war-room/redraftFreeAgentPool'
import { buildLineupRecommendation } from '@/lib/redraft-war-room/redraftLineupEngine'
import { buildWaiverRecommendations } from '@/lib/redraft-war-room/redraftWaiverEngine'
import { redraftTradeFacts } from '@/lib/redraft-war-room/redraftTradeEngine'
import { warRoomLegacyVerdict } from '@/lib/decision-os/trade/warRoomLegacyVerdict'
import type {
  RedraftDataAvailability,
  RedraftPlayerFact,
  RedraftWarRoomContext,
} from '@/lib/redraft-war-room/types'

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

const AVAIL = (over: Partial<RedraftDataAvailability> = {}): RedraftDataAvailability => ({
  scoringRules: 'available',
  rosterRules: 'available',
  standings: 'available',
  schedule: 'available',
  playerStats: 'available',
  projections: 'available',
  injuries: 'missing',
  news: 'missing',
  waiverPool: 'available',
  tradeValues: 'available',
  ...over,
})

function ctxWith(over: Partial<RedraftWarRoomContext>): RedraftWarRoomContext {
  return {
    leagueId: 'lg1',
    leagueType: 'redraft',
    sport: 'NFL',
    season: 2026,
    currentWeek: 6,
    totalWeeks: 17,
    playoffStartWeek: 15,
    seasonStatus: 'active',
    scoring: { sport: 'NFL', scoringPreset: 'PPR', pointsPerReception: 1, superflex: false, tePremium: false, idp: false },
    roster: {
      totalStarterSlots: 3,
      benchSlots: 4,
      irSlots: 0,
      lineupSlots: [
        { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'RB', allowedPositions: ['RB'], starterCount: 1, isFlex: false, isSuperflex: false },
        { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, isFlex: true, isSuperflex: false },
      ],
      requiredByPosition: { QB: 1, RB: 1, WR: 1, TE: 0 },
    },
    waivers: { type: 'faab', faabBudget: 100 },
    userRosterId: 'r1',
    isCommissioner: false,
    teams: over.teams ?? [],
    upcomingMatchup: null,
    recentMatchup: null,
    freeAgents: over.freeAgents ?? [],
    availability: over.availability ?? AVAIL(),
    freshness: { generatedAt: 'now', statsAsOf: null, projectionsAsOf: null, injuriesAsOf: null },
    missingDataFlags: over.missingDataFlags ?? [],
    featureAvailability: { teamNeeds: true, lineup: true, waivers: true, tradeAnalyze: true, tradeFind: true },
    ...over,
  }
}

function team(rosterId: string, players: RedraftPlayerFact[], isUser = false) {
  return {
    rosterId,
    ownerId: rosterId,
    ownerName: `Owner ${rosterId}`,
    teamName: `Team ${rosterId}`,
    wins: 3,
    losses: 3,
    ties: 0,
    pointsFor: 600,
    pointsAgainst: 600,
    streak: null,
    playoffSeed: null,
    faabBalance: 90,
    waiverPriority: 4,
    isEliminated: false,
    isUserTeam: isUser,
    players,
  }
}

describe('playerValue precedence (projection → season avg → ADP → none)', () => {
  it('prefers projection over season average and ADP', () => {
    const v = playerValue(player({ playerId: 'a', position: 'RB', weekProjection: 12, seasonAvgActual: 9, adp: 5 }))
    expect(v).toEqual({ value: 12, source: 'projection' })
  })
  it('falls back to season average when no projection', () => {
    const v = playerValue(player({ playerId: 'a', position: 'RB', seasonAvgActual: 9, adp: 5 }))
    expect(v).toEqual({ value: 9, source: 'season_avg' })
  })
  it('falls back to ADP value when no projection/actual', () => {
    const v = playerValue(player({ playerId: 'a', position: 'RB', adp: 10 }))
    expect(v.source).toBe('adp')
    expect(v.value).toBe(adpToValue(10))
    expect(v.value).toBeGreaterThan(0)
  })
  it('lower ADP yields higher value', () => {
    expect(adpToValue(1)).toBeGreaterThan(adpToValue(100))
  })
  it('returns none when no signal', () => {
    expect(playerValue(player({ playerId: 'a', position: 'RB' }))).toEqual({ value: 0, source: 'none' })
  })
  it('confidence maps source → high/medium/low/none', () => {
    expect(confidenceForSource('projection')).toBe('high')
    expect(confidenceForSource('season_avg')).toBe('medium')
    expect(confidenceForSource('adp')).toBe('low')
    expect(confidenceForSource('none')).toBe('none')
  })
})

describe('rosteredPlayerKeys', () => {
  it('builds lowercase name|pos keys for free-agent exclusion', () => {
    const keys = rosteredPlayerKeys([{ playerName: 'Bijan Robinson', position: 'RB' }])
    expect(keys.has('bijan robinson|rb')).toBe(true)
  })
})

describe('lineup engine confidence reflects weakest signal', () => {
  it('is high when all starters have projections', () => {
    const players = [
      player({ playerId: 'qb', position: 'QB', slotType: 'QB', isStarterSlot: true, weekProjection: 20 }),
      player({ playerId: 'rb', position: 'RB', slotType: 'RB', isStarterSlot: true, weekProjection: 15 }),
      player({ playerId: 'wr', position: 'WR', slotType: 'bench', weekProjection: 12 }),
    ]
    const r = buildLineupRecommendation(ctxWith({ teams: [team('r1', players, true)] }), 'r1')
    expect(r.confidence).toBe('high')
  })
  it('is low when starters are ranked off ADP only', () => {
    const players = [
      player({ playerId: 'qb', position: 'QB', slotType: 'QB', isStarterSlot: true, adp: 30 }),
      player({ playerId: 'rb', position: 'RB', slotType: 'RB', isStarterSlot: true, adp: 12 }),
      player({ playerId: 'wr', position: 'WR', slotType: 'bench', adp: 40 }),
    ]
    const r = buildLineupRecommendation(
      ctxWith({ teams: [team('r1', players, true)], availability: AVAIL({ projections: 'missing', playerStats: 'missing' }) }),
      'r1',
    )
    expect(r.confidence).toBe('low')
    expect(r.missingDataFlags.some((f) => /ADP\/ranking|low confidence/i.test(f))).toBe(true)
  })
})

describe('waiver engine ranks real free agents by ADP', () => {
  it('recommends ADP-ranked free agents at need positions and excludes nothing fabricated', () => {
    // Roster fills RB + WR so QB is the sole structural need position.
    const roster = [
      player({ playerId: 'rb1', position: 'RB', slotType: 'RB', isStarterSlot: true, weekProjection: 12 }),
      player({ playerId: 'wr1', position: 'WR', slotType: 'FLEX', isStarterSlot: true, weekProjection: 11 }),
    ]
    const freeAgents = [
      player({ playerId: 'qbFA|qb', playerName: 'FA QB', position: 'QB', slotType: 'free_agent', adp: 8 }),
      player({ playerId: 'wrFA|wr', playerName: 'FA WR', position: 'WR', slotType: 'free_agent', adp: 4 }),
    ]
    const ctx = ctxWith({ teams: [team('r1', roster, true)], freeAgents })
    const res = buildWaiverRecommendations(ctx, 'r1')
    expect(res.needsProviderIntegration).toBe(false)
    expect(res.targetPositions).toContain('QB')
    // QB is the need → surfaced first even though its ADP is worse than the WR.
    expect(res.recommendedAdds[0].position).toBe('QB')
    expect(res.recommendedAdds[0].adp).toBe(8)
    expect(res.recommendedAdds[0].valueSource).toBe('adp')
    expect(res.recommendedAdds[0].faabBidSuggestion).not.toBeNull()
  })
})

describe('trade engine uses ADP as ROS value when projections/actuals are missing', () => {
  it('produces a verdict (not needs_more_data) when only ADP values exist', () => {
    const ctx = ctxWith({
      teams: [
        team('r1', [player({ playerId: 'out', position: 'WR', adp: 80 })], true),
        team('r2', [player({ playerId: 'in', position: 'WR', adp: 10 })]),
      ],
      availability: AVAIL({ projections: 'missing', playerStats: 'missing', tradeValues: 'available' }),
    })
    const res = redraftTradeFacts(ctx, { rosterId: 'r1', outgoingPlayerIds: ['out'], incomingPlayerIds: ['in'] })
    expect(warRoomLegacyVerdict(res)).not.toBe('needs_more_data')
    // Receiving the much better ADP player is a value gain.
    expect(res.valueDelta ?? 0).toBeGreaterThan(0)
  })
})
