/**
 * A manager who runs two teams in one league gets TWO season teams when the draft finishes.
 *
 * Found by walking a 36-team league through the real app (2026-11-19): the season came out with 35
 * teams, one of them holding 26 players. The second team's season row was looked up and written under
 * the manager's user id, which is the first team's key, and `(seasonId, ownerId)` is unique, so both
 * rosters landed on one row. Runs the real finalization against the schema-driven in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as any }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.db
  },
  get default() {
    return holder.db
  },
}))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: 'evt' })) }),
}))

import { createInMemoryPrisma, rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { extraTeamOwnerKey } from '@/lib/league/rosterManager'

const LEAGUE = 'league-two-teams'
const SECOND_KEY = extraTeamOwnerKey('user-a', 'roster-c')
// user-a runs roster-a (their first team) and roster-c (a further team); user-b runs roster-b.
const TEAMS = [
  { rosterId: 'roster-a', ownerKey: 'user-a', managerUserId: null as string | null, claimedBy: 'user-a', teamName: 'Aces' },
  { rosterId: 'roster-b', ownerKey: 'user-b', managerUserId: null as string | null, claimedBy: 'user-b', teamName: 'Bears' },
  { rosterId: 'roster-c', ownerKey: SECOND_KEY, managerUserId: 'user-a', claimedBy: 'user-a', teamName: 'Comets' },
]
const PICKS = [
  { overall: 1, rosterId: 'roster-a', playerId: 'p1', playerName: 'Alex Archer', position: 'QB' },
  { overall: 2, rosterId: 'roster-b', playerId: 'p2', playerName: 'Blake Brooks', position: 'RB' },
  { overall: 3, rosterId: 'roster-c', playerId: 'p3', playerName: 'Cam Calloway', position: 'WR' },
  { overall: 4, rosterId: 'roster-c', playerId: 'p4', playerName: 'Dion Dunmore', position: 'TE' },
  { overall: 5, rosterId: 'roster-b', playerId: 'p5', playerName: 'Eli Eastman', position: 'WR' },
  { overall: 6, rosterId: 'roster-a', playerId: 'p6', playerName: 'Finn Farrow', position: 'RB' },
]

async function seed() {
  const db = holder.db
  for (const id of ['user-a', 'user-b']) await db.appUser.create({ data: { id, email: `${id}@test.allfantasy`, username: id } })
  await db.league.create({
    data: { id: LEAGUE, userId: 'user-a', name: 'Two Teams', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE, leagueType: 'redraft', isDynasty: false, leagueSize: 3, season: 2026, settings: { allow_multi_team_managers: true } },
  })
  for (const t of TEAMS) {
    await db.roster.create({ data: { id: t.rosterId, leagueId: LEAGUE, platformUserId: t.ownerKey, managerUserId: t.managerUserId, playerData: {} } })
    await db.leagueTeam.create({ data: { leagueId: LEAGUE, externalId: t.rosterId, teamName: t.teamName, ownerName: t.claimedBy, claimedByUserId: t.claimedBy } })
  }
  const session = await db.draftSession.create({
    data: {
      leagueId: LEAGUE, status: 'completed', draftType: 'snake', rounds: 2, teamCount: 3, sportType: 'NFL',
      slotOrder: TEAMS.map((t, i) => ({ slot: i + 1, rosterId: t.rosterId, userId: t.claimedBy, displayName: t.teamName })),
    },
  })
  for (const p of PICKS) {
    await db.draftPick.create({ data: { sessionId: session.id, overall: p.overall, round: Math.ceil(p.overall / 3), slot: ((p.overall - 1) % 3) + 1, rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: 'KC' } })
  }
}

beforeEach(() => {
  holder.db = createInMemoryPrisma()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('a manager with two teams, when the draft finishes', () => {
  it('gets a season team for each, with each team’s own players and its own name', async () => {
    await seed()
    const summary = await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(summary.skipped, JSON.stringify(summary)).toBe(false)

    const seasonRosters = rowsOf(holder.db, 'RedraftRoster').filter((r: any) => r.leagueId === LEAGUE)
    expect(seasonRosters).toHaveLength(3)

    const first = seasonRosters.find((r: any) => r.ownerId === 'user-a')
    const second = seasonRosters.find((r: any) => r.ownerId === SECOND_KEY)
    expect(first?.teamName).toBe('Aces')
    // The second team keeps its own key as the season owner and names its manager beside it.
    expect(second).toMatchObject({ teamName: 'Comets', managerUserId: 'user-a' })

    const linked = (rosterId: string) => rowsOf(holder.db, 'Roster').find((r: any) => r.id === rosterId)?.redraftRosterId
    expect(linked('roster-a')).toBe(first?.id)
    expect(linked('roster-c')).toBe(second?.id)
    expect(new Set(TEAMS.map((t) => linked(t.rosterId))).size).toBe(3)

    const playersOf = (seasonRosterId: string) =>
      rowsOf(holder.db, 'RedraftRosterPlayer').filter((p: any) => p.rosterId === seasonRosterId).map((p: any) => p.playerId).sort()
    expect(playersOf(first!.id)).toEqual(['p1', 'p6'])
    expect(playersOf(second!.id)).toEqual(['p3', 'p4'])
  })

  it('is still three teams when the finalization runs again', async () => {
    await seed()
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(rowsOf(holder.db, 'RedraftRoster').filter((r: any) => r.leagueId === LEAGUE)).toHaveLength(3)
    expect(rowsOf(holder.db, 'RedraftRosterPlayer')).toHaveLength(6)
  })
})
