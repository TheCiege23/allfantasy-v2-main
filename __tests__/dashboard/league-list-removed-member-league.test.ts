// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A league someone else imported, which the viewer removed (DELETE /api/league/[id] wrote their
 * tombstone; the league is shared, so nothing was deleted), leaves their list — and only theirs.
 *
 * Production 2026-10-30: a tester's two Sleeper leagues belonged to an account since deleted. They
 * reached them through a claimed team, so Remove found no row of theirs and the leagues stayed.
 */

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  calls: [] as Array<{ key: string; args: any }>,
  rawCalls: [] as Array<{ sql: string; values: unknown[] }>,
  rawResult: null as null | (() => unknown),
}))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) => (method === 'count' ? 0 : method === 'findMany' || method === 'groupBy' ? [] : null)
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push({ key: `${name}.${method}`, args })
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === '$queryRaw') {
          return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            db.rawCalls.push({ sql: strings.join('?'), values })
            return db.rawResult ? db.rawResult() : []
          })
        }
        if (key === 'then') return undefined
        return model(key)
      },
    },
  )
  return { prisma, default: prisma }
})

import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

const USER = 'tester'
const row = (id: string, owner: string, platform: string, platformLeagueId: string | null) => ({
  id,
  userId: owner,
  name: `League ${id}`,
  sport: 'NFL',
  leagueVariant: 'redraft',
  platform,
  platformLeagueId,
  leagueSize: 12,
  season: 2026,
  status: 'in_season',
  rosters: [],
  redraftMembers: [],
  teams: [],
  leagueSettings: null,
})

beforeEach(() => {
  db.calls = []
  db.rawCalls = []
  db.rawResult = null
  db.answers = {
    'league.findMany': (args) =>
      args?.where?.AND
        ? [
            row('shared', 'deleted-account', 'sleeper', '1389720315973627904'),
            row('kept', 'deleted-account', 'sleeper', '1355670398703788032'),
            row('mine', USER, 'sleeper', '999'),
            row('native', 'commish', 'allfantasy', 'af-1'),
          ]
        : [],
    'deletedLeagueTombstone.findMany': () => [
      { platform: 'sleeper', platformLeagueId: '1389720315973627904' },
      // A key that matches the viewer's own copy and a native league: neither is filtered.
      { platform: 'sleeper', platformLeagueId: '999' },
      { platform: 'allfantasy', platformLeagueId: 'af-1' },
    ],
  }
})

const ids = async () =>
  ((await getDashboardLeagueListForUser(USER)) as { leagues: Array<{ id: string }> }).leagues.map((l) => l.id).sort()

describe('dashboard league list — a removed member league', () => {
  it('🛑 drops an imported league someone else imported once the viewer tombstoned it', async () => {
    expect(await ids()).not.toContain('shared')
    expect(db.calls.find((c) => c.key === 'deletedLeagueTombstone.findMany')?.args?.where).toEqual({ userId: USER })
  })

  it('keeps every other league: an untombstoned import, the viewer\'s own copy, a native league', async () => {
    expect(await ids()).toEqual(['kept', 'native'])
  })

  it('does not resurface a removed import through a linked Sleeper row', async () => {
    db.answers['sleeperLeague.findMany'] = () => [
      { id: 'sleeper-copy', name: 'Sleeper copy', sleeperLeagueId: '999', totalTeams: 12, season: 2026, status: 'in_season', rosters: [] },
      { id: 'other-copy', name: 'Other copy', sleeperLeagueId: '777', totalTeams: 12, season: 2026, status: 'in_season', rosters: [] },
    ]
    expect(await ids()).not.toContain('sleeper-copy')
    expect(await ids()).toContain('other-copy')
  })

  it('CONTROL: with no tombstones, all four are listed', async () => {
    db.answers['deletedLeagueTombstone.findMany'] = () => []
    expect(await ids()).toEqual(['kept', 'mine', 'native', 'shared'])
  })

  it('a failed tombstone read hides nothing (the list is the /core membership gate)', async () => {
    db.answers['deletedLeagueTombstone.findMany'] = () => {
      throw new Error('boom')
    }
    expect(await ids()).toEqual(['kept', 'mine', 'native', 'shared'])
  })

  it('says which leagues the viewer can remove', async () => {
    db.answers['deletedLeagueTombstone.findMany'] = () => []
    const { leagues } = (await getDashboardLeagueListForUser(USER)) as { leagues: any[] }
    const by = (id: string) => leagues.find((l) => l.id === id)
    expect([by('shared').viewerOwnsRow, by('shared').viewerCanRemove]).toEqual([false, true])
    expect([by('mine').viewerOwnsRow, by('mine').viewerCanRemove]).toEqual([true, true])
    expect([by('native').viewerOwnsRow, by('native').viewerCanRemove]).toEqual([false, false])
  })
})
