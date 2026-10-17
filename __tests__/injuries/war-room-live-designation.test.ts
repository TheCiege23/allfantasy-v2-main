// @vitest-environment node
/**
 * 🛑 The redraft and keeper War Rooms let the STORED `RedraftRosterPlayer.injuryStatus` win over the live
 * injury feed (`p.injuryStatus ?? injuryByName…`) — so last week's "Out" zeroed a cleared starter's
 * projection, and a stored "Questionable" hid a player the feed now has Out. Both now take only the
 * feed's CURRENT designation (`currentDesignationFromFact`: a stale game-day word is suppressed, a healthy
 * word is no designation).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ facts: [] as Array<Record<string, unknown>>, rosterPlayers: [] as Array<Record<string, unknown>> }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const season = () => ({
    id: 's1',
    sport: 'NFL',
    season: 2026,
    status: 'in_season',
    currentWeek: 6,
    totalWeeks: 17,
    playoffStartWeek: 15,
    schedule: [],
    rosters: [
      {
        id: 'r1',
        ownerId: 'u1',
        ownerName: 'Me',
        teamName: 'Mine',
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        streak: null,
        playoffSeed: null,
        faabBalance: 100,
        waiverPriority: 1,
        isEliminated: false,
        players: state.rosterPlayers,
      },
    ],
  })
  const overrides: Record<string, Record<string, (args?: any) => Promise<unknown>>> = {
    league: {
      findUnique: async () => ({ settings: {}, sport: 'NFL', leagueSize: 2, leagueType: 'keeper', keeperCount: 2 }),
    },
    redraftSeason: { findFirst: async () => season() },
    fantasyProjection: {
      findMany: async () => state.rosterPlayers.map((p) => ({ playerId: p.playerId, projectedPoints: 15, fetchedAt: new Date() })),
    },
  }
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          overrides[name]?.[method] ?? (async () => (method === 'findMany' ? [] : method === 'count' ? 0 : null)),
      },
    )
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }
})
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true, isCommissioner: false })) }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({
  getEffectiveLeagueRosterTemplate: vi.fn(async () => ({ template: { slots: [] } })),
}))
vi.mock('@/lib/nfl-data-foundation/nflDataCoverage', () => ({ getCanonicalNflDataCoverage: vi.fn(async () => null) }))
vi.mock('@/lib/redraft-war-room/redraftFreeAgentPool', () => ({
  fetchAdpByPlayerKey: vi.fn(async () => new Map()),
  rosteredPlayerKeys: vi.fn(() => new Set()),
  fetchRedraftFreeAgentPool: vi.fn(async () => [
    { playerKey: 'fa-1', playerName: 'Free Agent Cleared', position: 'WR', team: 'DAL', adp: 120 },
  ]),
}))
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: vi.fn(async () => ({ facts: state.facts, newestFetchedAt: null, feedStale: false, coverage: { sourceAvailable: true, reason: null } })),
}))

import { buildRedraftWarRoomContext } from '@/lib/redraft-war-room/redraftWarRoomContext'
import { buildKeeperWarRoomContext } from '@/lib/keeper-war-room/keeperWarRoomContext'

const now = new Date()
const fact = (playerName: string, status: string, stale = false) => ({ playerName, status, team: 'Dallas Cowboys', position: 'WR', fetchedAt: now, stale })
const rp = (playerId: string, playerName: string, injuryStatus: string | null) => ({
  playerId,
  playerName,
  position: 'WR',
  team: 'DAL',
  slotType: 'WR',
  injuryStatus,
  byeWeek: null,
  isKept: false,
})

beforeEach(() => {
  state.rosterPlayers = [
    rp('p-snap', 'Stale Snapshot', 'Out'),
    rp('p-live', 'Live Out', null),
    rp('p-hidden', 'Stored Questionable', 'Questionable'),
    rp('p-lastweek', 'Last Week Out', null),
  ]
  state.facts = [
    fact('Live Out', 'Out'),
    fact('Stored Questionable', 'Out'),
    fact('Last Week Out', 'Out', true),
    fact('Free Agent Cleared', 'Active'),
  ]
})

function byName<T extends { playerName: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((r) => [r.playerName, r]))
}

describe('redraft War Room — the live designation wins, the stored snapshot is never served', () => {
  it('statuses and projections come from the feed’s current designation', async () => {
    const res = await buildRedraftWarRoomContext({ leagueId: 'L', userId: 'u1' })
    if (!res.ok) throw new Error(res.error)
    const players = byName(res.context.teams[0].players)
    expect(players['Stale Snapshot'].injuryStatus).toBeNull()
    expect(players['Stale Snapshot'].weekProjection).toBe(15)
    expect(players['Live Out'].injuryStatus).toBe('Out')
    expect(players['Live Out'].weekProjection).toBe(0)
    expect(players['Stored Questionable'].injuryStatus).toBe('Out')
    expect(players['Stored Questionable'].weekProjection).toBe(0)
    expect(players['Last Week Out'].injuryStatus).toBeNull()
    expect(byName(res.context.freeAgents)['Free Agent Cleared'].injuryStatus).toBeNull()
  })
})

describe('keeper War Room — the same rule', () => {
  it('roster and free-agent statuses come from the feed’s current designation', async () => {
    const res = await buildKeeperWarRoomContext({ leagueId: 'L', userId: 'u1' })
    if (!res.ok) throw new Error(res.error)
    const players = byName(res.context.teams[0].players)
    expect(players['Stale Snapshot'].injuryStatus).toBeNull()
    expect(players['Live Out'].injuryStatus).toBe('Out')
    expect(players['Stored Questionable'].injuryStatus).toBe('Out')
    expect(players['Last Week Out'].injuryStatus).toBeNull()
    expect(byName(res.context.freeAgents)['Free Agent Cleared'].injuryStatus).toBeNull()
  })
})
