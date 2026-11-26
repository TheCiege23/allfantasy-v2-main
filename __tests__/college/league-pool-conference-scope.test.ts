// @vitest-environment node
/**
 * The league player pool (`getPlayerPoolForLeague`) is what the draft room, autopick and the waiver wire
 * read, so the college conference scope is applied there, and the limit AFTER the filter: limiting first
 * would take the best N players from every school and leave a Big Ten + SEC league a fraction of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  settings: null as unknown,
  leagueReads: 0,
}))

vi.mock('@/lib/prisma', () => {
  const empty = { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) }
  const known: Record<string, unknown> = {
    sportsPlayer: { findMany: vi.fn(async () => h.players) },
    league: {
      findUnique: vi.fn(async () => {
        h.leagueReads += 1
        return { settings: h.settings }
      }),
    },
    sportsTeam: {
      findMany: vi.fn(async () => [
        { name: 'University of Alabama', shortName: 'ALA', conference: 'Southeastern Conference' },
        { name: 'Ohio State University', shortName: 'OSU', conference: 'Big Ten Conference' },
        { name: 'Campbell University', shortName: 'CAM', conference: 'Coastal Athletic Association' },
      ]),
    },
  }
  return { prisma: new Proxy(known, { get: (target, key: string) => target[key] ?? empty }) }
})

function row(id: string, name: string, team: string) {
  return {
    id, name, position: 'WR', team, teamId: null, status: 'ACT', sleeperId: null, externalId: id,
    age: 20, imageUrl: null, source: 'rolling_insights', yearsExp: null,
  }
}

beforeEach(() => {
  vi.resetModules() // the pool is memoised in-process
  h.leagueReads = 0
  // Campbell (FCS) rows first: an unscoped limit of 2 would return only Campbell players.
  h.players = [
    row('c1', 'Campbell One', 'Campbell University'),
    row('c2', 'Campbell Two', 'Campbell University'),
    row('a1', 'Alabama One', 'University of Alabama'),
    row('o1', 'Ohio State One', 'Ohio State University'),
  ]
})

const names = (pool: Array<{ full_name: string }>) => pool.map((p) => p.full_name).sort()

describe('getPlayerPoolForLeague and the college conference scope', () => {
  it('offers every school when the league has no scope (control)', async () => {
    h.settings = {}
    const { getPlayerPoolForLeague } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    expect(names(await getPlayerPoolForLeague('L1', 'NCAAF' as never))).toEqual(['Alabama One', 'Campbell One', 'Campbell Two', 'Ohio State One'])
  })

  it('offers only the scoped schools, and fills the limit from them', async () => {
    h.settings = { collegeConferenceScope: { preset: 'power' } }
    const { getPlayerPoolForLeague } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    expect(names(await getPlayerPoolForLeague('L1', 'NCAAF' as never))).toEqual(['Alabama One', 'Ohio State One'])
    expect(names(await getPlayerPoolForLeague('L1', 'NCAAF' as never, { limit: 2 }))).toEqual(['Alabama One', 'Ohio State One'])
    expect(await getPlayerPoolForLeague('L1', 'NCAAF' as never, { limit: 1 })).toHaveLength(1)
  })

  it('never reads league settings for a pro league', async () => {
    h.settings = { collegeConferenceScope: { preset: 'power' } }
    const { getPlayerPoolForLeague } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    await getPlayerPoolForLeague('L1', 'NBA' as never, { limit: 5 })
    expect(h.leagueReads).toBe(0)
  })
})
