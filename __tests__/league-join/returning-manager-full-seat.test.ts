/**
 * A manager the commissioner removed (`releaseLeagueSeat`) who comes back through the invite is matched
 * BY NAME to their old team — the release keeps the team's owner name. That path set only
 * `Roster.platformUserId`: the team stayed orphaned and unclaimed and the season roster stayed "Open
 * team", so the season's results skipped it as an unmapped owner (dynasty simulation, 2026-11-08).
 * Runs the real release and claim against the schema-driven in-memory Prisma.
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

import { createInMemoryPrisma, rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import { releaseLeagueSeat } from '@/lib/league/leagueSeats'
import { claimPlaceholderRoster } from '@/lib/league-import/placeholderClaim'

const LEAGUE = 'league-returning'

async function seedLeague() {
  const db = holder.db
  for (const id of ['commish', 'manager-b']) await db.appUser.create({ data: { id, email: `${id}@test.allfantasy`, username: id, displayName: id } })
  await db.league.create({ data: { id: LEAGUE, userId: 'commish', name: 'Returning', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE, leagueType: 'dynasty', isDynasty: true, leagueSize: 2, season: 2026, settings: {} } })
  const season = await db.redraftSeason.create({ data: { leagueId: LEAGUE, sport: 'NFL', season: 2026, status: 'in_season', totalWeeks: 14, playoffStartWeek: 15, currentWeek: 8 } })
  for (const [rosterId, userId, wins] of [['roster-a', 'commish', 5], ['roster-b', 'manager-b', 4]] as const) {
    const rr = await db.redraftRoster.create({ data: { seasonId: season.id, leagueId: LEAGUE, ownerId: userId, ownerName: userId, teamName: `${userId}'s Team`, wins, losses: 3, faabBalance: 80 } })
    await db.roster.create({ data: { id: rosterId, leagueId: LEAGUE, platformUserId: userId, playerData: { foundation: { slotNumber: rosterId === 'roster-a' ? 1 : 2 } }, redraftRosterId: rr.id } })
    await db.leagueTeam.create({ data: { leagueId: LEAGUE, externalId: rosterId, platformUserId: userId, claimedByUserId: userId, ownerName: userId, teamName: `${userId}'s Team` } })
    await db.redraftLeagueMember.create({ data: { leagueId: LEAGUE, userId } }).catch(() => undefined)
  }
  return season.id
}

beforeEach(() => {
  holder.db = createInMemoryPrisma()
})

describe('a removed manager who rejoins gets the whole seat back', () => {
  it('roster, team, membership and the season roster — not the league roster alone', async () => {
    const seasonId = await seedLeague()
    const released = await holder.db.$transaction((tx: unknown) => releaseLeagueSeat(tx as never, { leagueId: LEAGUE, rosterId: 'roster-b' }))
    expect(released.ok).toBe(true)
    const seasonRoster = () => (rowsOf(holder.db, 'RedraftRoster') as any[]).find((r) => r.seasonId === seasonId && r.wins === 4)
    expect(seasonRoster().ownerId).not.toBe('manager-b') // released: open

    const claim = await holder.db.$transaction((tx: unknown) =>
      claimPlaceholderRoster({ tx: tx as never, leagueId: LEAGUE, candidate: { appUserId: 'manager-b', displayName: 'manager-b', sleeperUsername: null, email: 'manager-b@test.allfantasy' } }),
    )
    expect(claim).toMatchObject({ claimed: true, rosterId: 'roster-b' })

    const roster = (rowsOf(holder.db, 'Roster') as any[]).find((r) => r.id === 'roster-b')
    const team = (rowsOf(holder.db, 'LeagueTeam') as any[]).find((t) => t.externalId === 'roster-b')
    expect(roster.platformUserId).toBe('manager-b')
    expect(team).toMatchObject({ claimedByUserId: 'manager-b', isOrphan: false })
    expect(seasonRoster()).toMatchObject({ ownerId: 'manager-b', wins: 4, faabBalance: 80 })
    expect((rowsOf(holder.db, 'RedraftLeagueMember') as any[]).some((m) => m.userId === 'manager-b')).toBe(true)
  })
})
