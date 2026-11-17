/**
 * A league that drafts here must have its league rosters linked to the season rosters the draft creates
 * (`Roster.redraftRosterId`). Trades, waiver claims, free-agent adds and trade reversals reach the season
 * roster — the one lineups and scoring read — only through that link (`applyRedraftRosterMoves`), and with
 * it unset the write is skipped without an error: a traded player kept scoring for his old team.
 *
 * Draft finalization linked only Survivor leagues, and the reconciler's other callers are import paths, so
 * a native dynasty or redraft league was never linked. Found by the dynasty season simulation (0 of 12).
 * Runs the real finalization and the real move sync against the schema-driven in-memory Prisma.
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
import { applyRedraftRosterMoves } from '@/lib/league-runtime/redraftRosterMoveSync'

const LEAGUE = 'league-links'
const TEAMS = [
  { rosterId: 'roster-a', userId: 'user-a' },
  { rosterId: 'roster-b', userId: 'user-b' },
]
const PICKS = [
  { overall: 1, round: 1, rosterId: 'roster-a', playerId: 'p-qb-1', playerName: 'Alex Archer', position: 'QB' },
  { overall: 2, round: 1, rosterId: 'roster-b', playerId: 'p-rb-1', playerName: 'Blake Brooks', position: 'RB' },
  { overall: 3, round: 2, rosterId: 'roster-b', playerId: 'p-wr-1', playerName: 'Cam Calloway', position: 'WR' },
  { overall: 4, round: 2, rosterId: 'roster-a', playerId: 'p-te-1', playerName: 'Dion Dunmore', position: 'TE' },
]

async function seedDraftedDynastyLeague(survivorMode = false) {
  const db = holder.db
  for (const t of TEAMS) await db.appUser.create({ data: { id: t.userId, email: `${t.userId}@test.allfantasy`, username: t.userId } })
  await db.league.create({
    data: { id: LEAGUE, userId: 'user-a', name: 'Links League', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE, leagueType: 'dynasty', isDynasty: true, survivorMode, leagueSize: 2, season: 2026, settings: {} },
  })
  for (const t of TEAMS) {
    await db.roster.create({ data: { id: t.rosterId, leagueId: LEAGUE, platformUserId: t.userId, playerData: {} } })
  }
  const session = await db.draftSession.create({
    data: {
      leagueId: LEAGUE,
      status: 'completed',
      draftType: 'snake',
      rounds: 2,
      teamCount: 2,
      sportType: 'NFL',
      slotOrder: TEAMS.map((t, i) => ({ slot: i + 1, rosterId: t.rosterId, userId: t.userId, displayName: t.userId })),
    },
  })
  for (const p of PICKS) {
    await db.draftPick.create({ data: { sessionId: session.id, overall: p.overall, round: p.round, slot: ((p.overall - 1) % 2) + 1, rosterId: p.rosterId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: 'KC' } })
  }
}

beforeEach(() => {
  holder.db = createInMemoryPrisma()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('draft finalization links league rosters to the season rosters it creates', () => {
  it('links every team in a native dynasty league, not only Survivor', async () => {
    await seedDraftedDynastyLeague()
    const summary = await syncCompletedDraftToRedraftSeason(LEAGUE)
    expect(summary.skipped, JSON.stringify(summary)).toBe(false)

    const seasonRosters = rowsOf(holder.db, 'RedraftRoster').filter((r: any) => r.leagueId === LEAGUE)
    expect(seasonRosters).toHaveLength(2)
    for (const t of TEAMS) {
      const generic = rowsOf(holder.db, 'Roster').find((r: any) => r.id === t.rosterId)
      const expected = seasonRosters.find((r: any) => r.ownerId === t.userId)
      expect(generic?.redraftRosterId, `${t.rosterId} linked`).toBe(expected?.id)
    }
  })

  it('so a traded player moves onto the receiving team’s season roster', async () => {
    await seedDraftedDynastyLeague()
    await syncCompletedDraftToRedraftSeason(LEAGUE)

    // The move the trade processor sends for "roster-a gives p-qb-1 to roster-b".
    await holder.db.$transaction(async (tx: any) => {
      await applyRedraftRosterMoves(tx, { leagueId: LEAGUE, acquisitionType: 'trade', moves: [{ playerId: 'p-qb-1', fromRosterId: 'roster-a', toRosterId: 'roster-b' }] })
    })

    const seasonRosterOf = (userId: string) => rowsOf(holder.db, 'RedraftRoster').find((r: any) => r.ownerId === userId)!.id
    const live = rowsOf(holder.db, 'RedraftRosterPlayer').filter((p: any) => p.playerId === 'p-qb-1' && !p.droppedAt)
    expect(live.map((p: any) => p.rosterId)).toEqual([seasonRosterOf('user-b')])
  })

  it('heals a league that drafted before the fix at its next move', async () => {
    await seedDraftedDynastyLeague()
    await syncCompletedDraftToRedraftSeason(LEAGUE)
    // The state every league drafted before this fix is in: season rosters exist, links do not.
    await holder.db.roster.updateMany({ where: { leagueId: LEAGUE }, data: { redraftRosterId: null } })

    const { ensureSeasonRosterLinksBeforeMove } = await import('@/lib/league-runtime/reconcileRosterRedraftLinks')
    await ensureSeasonRosterLinksBeforeMove(LEAGUE)
    await holder.db.$transaction(async (tx: any) => {
      await applyRedraftRosterMoves(tx, { leagueId: LEAGUE, acquisitionType: 'trade', moves: [{ playerId: 'p-qb-1', fromRosterId: 'roster-a', toRosterId: 'roster-b' }] })
    })

    const target = rowsOf(holder.db, 'RedraftRoster').find((r: any) => r.ownerId === 'user-b')!.id
    expect(rowsOf(holder.db, 'RedraftRosterPlayer').filter((p: any) => p.playerId === 'p-qb-1' && !p.droppedAt).map((p: any) => p.rosterId)).toEqual([target])
  })
})
