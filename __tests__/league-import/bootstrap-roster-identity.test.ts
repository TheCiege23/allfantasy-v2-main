/**
 * @vitest-environment node
 *
 * Drives the real `bootstrapLeagueFromNormalizedImport` — which both the import and the four-hourly
 * Sleeper sync run — against an in-memory `rosters` table that enforces the real unique key
 * `(leagueId, platformUserId)`, so a write the database would refuse fails here too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; leagueId: string; platformUserId: string; playerData: any; createdAt: number }
type Team = { id: string; leagueId: string; externalId: string; claimedByUserId: string | null; platformUserId: string | null }

const db = vi.hoisted(() => ({
  rosters: [] as Row[],
  teams: [] as Team[],
  seq: 0,
  linked: new Map<string, string>(),
}))

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`leagueId`,`platformUserId`)'), { code: 'P2002' })
}
function checkUnique(leagueId: string, platformUserId: string, exceptId?: string) {
  if (db.rosters.some((r) => r.leagueId === leagueId && r.platformUserId === platformUserId && r.id !== exceptId)) {
    throw uniqueViolation()
  }
}
/** A PrismaPromise stand-in: nothing runs until it is awaited, as with the real client. */
function lazy<T>(fn: () => T): PromiseLike<T> {
  let p: Promise<T> | null = null
  return { then: (res, rej) => (p ??= Promise.resolve().then(fn)).then(res, rej) }
}

vi.mock('@/lib/prisma', () => {
  const roster = {
    findMany: ({ where }: any) => lazy(() => db.rosters.filter((r) => r.leagueId === where.leagueId).map((r) => ({ ...r }))),
    // The pre-fix bootstrap's lookup, kept so the "fails on the old code" check can run.
    findFirst: ({ where }: any) =>
      lazy(() => {
        const keys = (where.OR ?? []).map((o: any) => o.platformUserId)
        const hit = db.rosters.find((r) => r.leagueId === where.leagueId && keys.includes(r.platformUserId))
        return hit ? { id: hit.id } : null
      }),
    update: ({ where, data }: any) =>
      lazy(() => {
        const r = db.rosters.find((x) => x.id === where.id)
        if (!r) throw new Error('record not found')
        if (data.platformUserId !== undefined) checkUnique(r.leagueId, data.platformUserId, r.id)
        Object.assign(r, data)
        return { ...r }
      }),
    create: ({ data }: any) =>
      lazy(() => {
        checkUnique(data.leagueId, data.platformUserId)
        const r: Row = { id: `new-${++db.seq}`, createdAt: db.seq, ...data }
        db.rosters.push(r)
        return { ...r }
      }),
  }
  const leagueTeam = {
    findMany: ({ where }: any) => lazy(() => db.teams.filter((t) => t.leagueId === where.leagueId).map((t) => ({ ...t }))),
    upsert: ({ where, create, update }: any) =>
      lazy(() => {
        const key = where.leagueId_externalId
        const t = db.teams.find((x) => x.leagueId === key.leagueId && x.externalId === key.externalId)
        if (t) Object.assign(t, update)
        else db.teams.push({ id: `t-${key.externalId}`, claimedByUserId: null, platformUserId: null, ...create })
        return {}
      }),
  }
  return {
    prisma: {
      roster,
      leagueTeam,
      appUser: { findMany: () => lazy(() => []) },
      userProfile: {
        findMany: () => lazy(() => [...db.linked].map(([sleeperUserId, userId]) => ({ sleeperUserId, userId }))),
      },
      teamPerformance: { upsert: () => lazy(() => ({})) },
      $transaction: async (ops: PromiseLike<unknown>[]) => {
        const snapshot = db.rosters.map((r) => ({ ...r }))
        try {
          const out = []
          for (const op of ops) out.push(await op)
          return out
        } catch (e) {
          db.rosters = snapshot
          throw e
        }
      },
    },
  }
})

import { bootstrapLeagueFromNormalizedImport } from '@/lib/league-import/sleeper/SleeperLeagueCreationBootstrapService'

const L = 'league-1'
function team(teamId: string, managerId: string, players: string[], extra: Record<string, unknown> = {}) {
  return {
    source_team_id: teamId,
    source_manager_id: managerId,
    owner_name: managerId ? `Manager ${managerId}` : 'Unknown',
    team_name: `Team ${teamId}`,
    avatar_url: null,
    is_commissioner: false,
    is_co_commissioner: false,
    is_orphan: !managerId,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
    player_ids: players,
    starter_ids: [],
    reserve_ids: [],
    taxi_ids: [],
    ...extra,
  }
}
function snapshot(rosters: unknown[]) {
  return {
    source: { source_provider: 'sleeper', source_league_id: 'S1', source_season_id: '2026', import_batch_id: null, imported_at: '2026-09-17T00:00:00Z' },
    league: { season: 2026 },
    rosters,
    standings: [],
    schedule: [],
  } as any
}
const run = (rosters: unknown[]) => bootstrapLeagueFromNormalizedImport(L, snapshot(rosters))
const rowsOf = (teamId: string) => db.rosters.filter((r) => r.playerData?.source_team_id === teamId)
const seedRow = (id: string, key: string, teamId: string, players: string[] = []) =>
  db.rosters.push({ id, leagueId: L, platformUserId: key, playerData: { source_team_id: teamId, players }, createdAt: 0 })

beforeEach(() => {
  db.rosters = []
  db.teams = []
  db.seq = 0
  db.linked = new Map()
})

describe('🛑 every orphan team keeps its own roster', () => {
  const league = [
    team('1', 'mgr-1', ['a']),
    team('10', '', ['o10']),
    team('11', '', ['o11']),
    team('12', '', ['o12']),
  ]

  it('stores each orphan under its own key, with its own players', async () => {
    await run(league)
    for (const id of ['10', '11', '12']) {
      expect(rowsOf(id)).toHaveLength(1)
      expect(rowsOf(id)[0]).toMatchObject({ platformUserId: `orphan-sleeper-${id}` })
      expect(rowsOf(id)[0].playerData.players).toEqual([`o${id}`])
    }
    expect(db.rosters).toHaveLength(4)
  })

  it('is stable on the next sync', async () => {
    await run(league)
    const ids = db.rosters.map((r) => r.id).sort()
    const second = await run(league)
    expect(db.rosters.map((r) => r.id).sort()).toEqual(ids)
    expect(second.rostersRekeyed).toBe(0)
  })

  it('moves the one row a league kept under \'\' onto its team\'s key', async () => {
    // What production holds today: the last orphan written owns the only '' row.
    seedRow('legacy', '', '12', ['o12'])
    const out = await run(league)
    expect(rowsOf('12')).toEqual([expect.objectContaining({ id: 'legacy', platformUserId: 'orphan-sleeper-12' })])
    expect(rowsOf('10')).toHaveLength(1)
    expect(rowsOf('11')).toHaveLength(1)
    expect(out.rostersRekeyed).toBe(1)
  })
})

describe('🛑 an owner change moves the team\'s row, and adds none', () => {
  it('a new manager takes over the same row', async () => {
    await run([team('3', 'mgr-old', ['p1'])])
    const id = rowsOf('3')[0].id
    await run([team('3', 'mgr-new', ['p1', 'p2'])])
    expect(rowsOf('3')).toEqual([expect.objectContaining({ id, platformUserId: 'mgr-new' })])
    expect(rowsOf('3')[0].playerData.players).toEqual(['p1', 'p2'])
  })

  it('a team that loses its manager, then gains one, stays one row', async () => {
    await run([team('3', 'mgr-old', ['p1'])])
    await run([team('3', '', ['p1'])])
    await run([team('3', 'mgr-new', ['p1'])])
    expect(rowsOf('3')).toHaveLength(1)
    expect(rowsOf('3')[0].platformUserId).toBe('mgr-new')
  })

  it('two managers who swap teams do not trip the unique key', async () => {
    await run([team('1', 'mgr-a', ['a1']), team('2', 'mgr-b', ['b1'])])
    const [id1, id2] = [rowsOf('1')[0].id, rowsOf('2')[0].id]
    await run([team('1', 'mgr-b', ['a1']), team('2', 'mgr-a', ['b1'])])
    expect(rowsOf('1')).toEqual([expect.objectContaining({ id: id1, platformUserId: 'mgr-b' })])
    expect(rowsOf('2')).toEqual([expect.objectContaining({ id: id2, platformUserId: 'mgr-a' })])
  })
})

describe('🛑 a claimed team keeps its claimant key', () => {
  it('a claim made through an invite is not undone by the next sync', async () => {
    // The resolver cannot see this claim: the manager never linked their Sleeper account.
    db.teams.push({ id: 't-5', leagueId: L, externalId: '5', claimedByUserId: 'af-user', platformUserId: 'sleeper-9' })
    seedRow('claimed', 'af-user', '5', ['x'])
    await run([team('5', 'sleeper-9', ['x', 'y'])])
    expect(rowsOf('5')).toEqual([expect.objectContaining({ id: 'claimed', platformUserId: 'af-user' })])
    expect(rowsOf('5')[0].playerData.players).toEqual(['x', 'y'])
  })

  it('a linked manager is keyed by their AllFantasy account', async () => {
    db.linked.set('sleeper-9', 'af-linked')
    await run([team('5', 'sleeper-9', ['x'])])
    expect(rowsOf('5')[0].platformUserId).toBe('af-linked')
  })
})

describe('what it leaves alone', () => {
  it('a duplicate row already there is not deleted, and is reported', async () => {
    seedRow('ghost', 'mgr-old', '4', ['g'])
    seedRow('real', 'mgr-new', '4', ['r'])
    const out = await run([team('4', 'mgr-new', ['r2'])])
    expect(rowsOf('4').map((r) => r.id).sort()).toEqual(['ghost', 'real'])
    expect(db.rosters.find((r) => r.id === 'real')!.playerData.players).toEqual(['r2'])
    expect(db.rosters.find((r) => r.id === 'ghost')!.playerData.players).toEqual(['g'])
    expect(out.rosterDuplicateRows).toBe(1)
  })

  it('a team whose fetch failed keeps its stored row and key (IMP-04)', async () => {
    seedRow('r3', 'mgr-old', '3', ['kept'])
    await run([team('3', 'mgr-new', [], { fetch_status: 'failed' })])
    expect(rowsOf('3')).toEqual([expect.objectContaining({ id: 'r3', platformUserId: 'mgr-old' })])
    expect(rowsOf('3')[0].playerData.players).toEqual(['kept'])
  })

  it('a key held by a row outside the import is reported, not forced', async () => {
    seedRow('r1', 'mgr-a', '1', ['a'])
    seedRow('stale', 'mgr-b', '9', ['s'])
    const out = await run([team('1', 'mgr-b', ['a'])])
    expect(rowsOf('1')).toEqual([expect.objectContaining({ id: 'r1', platformUserId: 'mgr-a' })])
    expect(out.rosterKeyConflicts).toBe(1)
  })
})
