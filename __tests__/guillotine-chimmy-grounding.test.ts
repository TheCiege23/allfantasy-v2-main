import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuillotineWarRoomContext } from '@/lib/guillotine-war-room/types'

const mocks = vi.hoisted(() => ({ buildContext: vi.fn() }))

vi.mock('@/lib/guillotine-war-room/guillotineWarRoomContext', () => ({
  buildGuillotineWarRoomContext: mocks.buildContext,
}))

import { buildGuillotineWarRoomContextForChimmy } from '@/lib/guillotine-war-room/guillotineChimmyGrounding'

function makeContext(): GuillotineWarRoomContext {
  return {
    leagueId: 'lg1',
    leagueType: 'guillotine',
    sport: 'NFL',
    season: 2026,
    currentWeek: 5,
    scoring: { sport: 'NFL', scoringPreset: 'PPR' },
    roster: { totalStarterSlots: 7, benchSlots: 5, requiredByPosition: { QB: 1, RB: 3, WR: 3, TE: 1 } },
    guillotine: {
      eliminationStartWeek: 1,
      eliminationEndWeek: 17,
      teamsPerChop: 1,
      dangerMarginPoints: 10,
      tiebreaker: 'season_points',
      rosterReleaseTiming: 'next_waiver_run',
      tradesEnabled: false,
    },
    userRosterId: 'r1',
    isCommissioner: false,
    activeTeamCount: 8,
    eliminatedTeamCount: 2,
    standings: [
      {
        rosterId: 'r1',
        ownerName: 'Me',
        teamName: 'My Team',
        isUserTeam: true,
        eliminated: false,
        choppedInPeriod: null,
        rank: 1,
        seasonPointsCumul: 410,
        periodPoints: 88,
        tier: 'chop_zone',
        pointsFromChopZone: 0,
      },
    ],
    teams: [
      {
        rosterId: 'r1',
        ownerId: 'u1',
        ownerName: 'Me',
        teamName: 'My Team',
        isUserTeam: true,
        eliminated: false,
        faabRemaining: 80,
        players: [
          { playerId: 'rb1', playerName: 'RB One', position: 'RB', team: 'ATL', slotType: 'starter', isStarterSlot: true, injuryStatus: null, adp: 12, weekProjection: 14, seasonAvgActual: null, hasNoValueSignal: false },
          { playerId: 'wr1', playerName: 'WR One', position: 'WR', team: 'MIN', slotType: 'starter', isStarterSlot: true, injuryStatus: null, adp: 8, weekProjection: 16, seasonAvgActual: null, hasNoValueSignal: false },
        ],
      },
    ],
    droppedPlayers: [],
    availability: {
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
    },
    freshness: { generatedAt: 'now', scoresAsOf: null, injuriesAsOf: null },
    missingDataFlags: ['No eliminated-team dropped-player pool available yet.'],
    featureAvailability: {
      survivalRisk: true,
      rosterRisk: true,
      lineupSafety: true,
      waivers: true,
      faabPlan: true,
      droppedPlayers: false,
      tradeAnalyze: false,
      weeklyPlan: true,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildContext.mockResolvedValue({ ok: true, context: makeContext() })
})

describe('buildGuillotineWarRoomContextForChimmy', () => {
  it('returns null when no leagueId/userId', async () => {
    expect(await buildGuillotineWarRoomContextForChimmy('', 'u1')).toBeNull()
    expect(await buildGuillotineWarRoomContextForChimmy('lg1', '')).toBeNull()
  })

  it('returns null when the context build is not ok (non-guillotine / forbidden)', async () => {
    mocks.buildContext.mockResolvedValue({ ok: false, status: 404, error: 'Not a Guilly league' })
    expect(await buildGuillotineWarRoomContextForChimmy('lg1', 'u1')).toBeNull()
  })

  it('grounds a Guilly league with survival-first rules, standings, and weekly plan', async () => {
    const out = await buildGuillotineWarRoomContextForChimmy('lg1', 'u1')
    expect(out).toBeTruthy()
    const text = out as string
    expect(text).toMatch(/GUILLY AF WAR ROOM CONTEXT/)
    expect(text.toUpperCase()).toContain('SURVIVAL-FIRST')
    expect(text.toLowerCase()).toContain('do not invent eliminated teams')
    expect(text).toMatch(/SURVIVAL STANDINGS/)
    expect(text).toMatch(/WEEKLY SURVIVAL PLAN/)
    // No-fake honesty surfaced (dropped pool missing).
    expect(text.toLowerCase()).toContain('dropped-player pool')
  })
})
