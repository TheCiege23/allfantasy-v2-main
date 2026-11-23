/**
 * A league rolling over for the SECOND time gets a new season, not its first one back.
 *
 * `ensureNextRedraftSeasonShell` returns a later season when one already exists. It used to accept any
 * other season as "already exists", which held with one season on file and failed with two: going from
 * year two to year three it returned year one, so no season was created and the next draft was attached
 * to the first season. Found re-walking a dynasty league through two offseasons.
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
import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'

const LEAGUE = 'league-three-years'

async function seed(seasons: Array<{ id: string; season: number; status: string }>) {
  const db = holder.db
  for (const id of ['user-a', 'user-b']) await db.appUser.create({ data: { id, email: `${id}@test.allfantasy`, username: id } })
  await db.league.create({
    data: { id: LEAGUE, userId: 'user-a', name: 'Three Years', sport: 'NFL', platform: 'manual', platformLeagueId: LEAGUE, leagueType: 'dynasty', isDynasty: true, leagueSize: 2, season: seasons.at(-1)!.season, settings: {} },
  })
  let t = Date.parse('2026-01-01T00:00:00Z')
  for (const s of seasons) {
    await db.redraftSeason.create({ data: { id: s.id, leagueId: LEAGUE, sport: 'NFL', season: s.season, status: s.status, totalWeeks: 14, playoffStartWeek: 15, currentWeek: 14, createdAt: new Date((t += 86_400_000)) } })
    for (const owner of ['user-a', 'user-b']) {
      await db.redraftRoster.create({ data: { seasonId: s.id, leagueId: LEAGUE, ownerId: owner, ownerName: owner, teamName: `${owner} team` } })
    }
  }
}
const seasonsOnFile = () => rowsOf(holder.db, 'RedraftSeason').map((s: any) => s.season).sort()

beforeEach(() => {
  holder.db = createInMemoryPrisma()
})

describe('the next season after a completed one', () => {
  it('🛑 the second rollover creates year three, and does not hand back year one', async () => {
    await seed([{ id: 's-2026', season: 2026, status: 'complete' }, { id: 's-2027', season: 2027, status: 'complete' }])
    const next = await ensureNextRedraftSeasonShell(LEAGUE, 's-2027')
    expect(next?.season).toBe(2028)
    expect(next?.id).not.toBe('s-2026')
    expect(seasonsOnFile()).toEqual([2026, 2027, 2028])
    const created = rowsOf(holder.db, 'RedraftSeason').find((s: any) => s.season === 2028)
    expect(created.status).toBe('setup')
    // Last season's two teams carried over as the new season's teams.
    expect(rowsOf(holder.db, 'RedraftRoster').filter((r: any) => r.seasonId === created.id)).toHaveLength(2)
  })

  it('[control] the first rollover creates year two', async () => {
    await seed([{ id: 's-2026', season: 2026, status: 'complete' }])
    expect((await ensureNextRedraftSeasonShell(LEAGUE, 's-2026'))?.season).toBe(2027)
    expect(seasonsOnFile()).toEqual([2026, 2027])
  })

  it('a later season that already exists is returned, and nothing is created', async () => {
    await seed([{ id: 's-2026', season: 2026, status: 'complete' }, { id: 's-2027', season: 2027, status: 'complete' }, { id: 's-2028', season: 2028, status: 'setup' }])
    expect(await ensureNextRedraftSeasonShell(LEAGUE, 's-2027')).toEqual({ id: 's-2028', season: 2028 })
    // Asked again, as a retry would: still the same season, still three on file.
    expect(await ensureNextRedraftSeasonShell(LEAGUE, 's-2027')).toEqual({ id: 's-2028', season: 2028 })
    expect(seasonsOnFile()).toEqual([2026, 2027, 2028])
  })
})
