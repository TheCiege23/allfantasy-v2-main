import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveNames` at league scale — the lookup the Chimmy trade-target verdict and the trade and
 * lineup scenarios name whole leagues with.
 *
 * 🛑 Measured on staging 2026-09-17, in a real 12-team Sleeper league (192 rostered ids): a rostered
 * Adam Thielen came back "not on any roster". The fallback read was capped at 120 rows and matched
 * Sleeper ids against `externalId`, where a bare number belongs to a different person 42,031 times
 * in 42,032 (`lib/player-identity/externalIdNamespace.ts`).
 *
 * The Prisma double below evaluates `where` (equality, `in`, `OR`), `orderBy` and `take` for real,
 * so a reintroduced row cap or an unscoped `externalId` match fails here rather than passing
 * against a stub that ignores the query.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ records: [] as Row[], players: [] as Row[], playerQueries: [] as Row[] }))

function matches(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false
      continue
    }
    if (cond && typeof cond === 'object' && 'in' in (cond as Row)) {
      if (!((cond as { in: unknown[] }).in).includes(row[key])) return false
      continue
    }
    if (row[key] !== cond) return false
  }
  return true
}

function query(rows: Row[], args: Row): Row[] {
  let out = rows.filter((r) => matches(r, (args.where ?? {}) as Row))
  const order = args.orderBy as Record<string, 'asc' | 'desc'> | undefined
  if (order?.fetchedAt) {
    const dir = order.fetchedAt === 'desc' ? -1 : 1
    out = [...out].sort((a, b) => dir * ((a.fetchedAt as number) - (b.fetchedAt as number)))
  }
  if (typeof args.take === 'number') out = out.slice(0, args.take)
  return out
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: { findMany: vi.fn(async (args: Row) => query(state.records, args)) },
    sportsPlayer: {
      findMany: vi.fn(async (args: Row) => {
        state.playerQueries.push(args)
        return query(state.players, args)
      }),
    },
  },
}))

import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'

const player = (over: Row): Row => ({
  sport: 'NFL',
  externalId: 'x',
  sleeperId: null,
  name: 'Nobody',
  position: 'WR',
  team: 'FA',
  status: null,
  source: 'sleeper',
  fetchedAt: 1,
  ...over,
})

beforeEach(() => {
  state.records = []
  state.players = []
  state.playerQueries = []
})

describe('resolveNames — the Sleeper id space is asked for Sleeper ids', () => {
  it('🛑 a Rolling Insights row whose bare id equals a Sleeper id does not take that player\'s name', async () => {
    state.players = [
      // A provider row: externalId is the same number as Thielen's Sleeper id — a different person.
      player({ externalId: '4981', source: 'rolling_insights', name: 'Somebody Else', position: 'LB', fetchedAt: 9 }),
      player({ externalId: 'sleeper:4981', sleeperId: '4981', name: 'Adam Thielen', position: 'WR', fetchedAt: 1 }),
    ]
    const names = await resolveNames('NFL', ['4981'], 800)
    expect(names.get('4981')).toMatchObject({ name: 'Adam Thielen', position: 'WR' })
  })

  it('🛑 a bare number the Sleeper space does not claim stays UNNAMED — never a provider stranger', async () => {
    state.players = [player({ externalId: '7777', source: 'rolling_insights', name: 'A Stranger' })]
    const names = await resolveNames('NFL', ['7777'], 800)
    expect(names.has('7777')).toBe(false)
  })

  it('the `sleeper:` spelling with no sleeperId column still resolves the bare id', async () => {
    state.players = [player({ externalId: 'sleeper:6794', sleeperId: null, name: 'Justin Jefferson' })]
    const names = await resolveNames('NFL', ['6794'], 800)
    expect(names.get('6794')?.name).toBe('Justin Jefferson')
  })

  it('the freshest row wins when a player has several', async () => {
    state.players = [
      player({ externalId: 'sleeper:1', sleeperId: '1', name: 'Old Name', team: 'OLD', fetchedAt: 1 }),
      player({ externalId: 'sleeper:1', sleeperId: '1', name: 'New Name', team: 'NEW', fetchedAt: 5 }),
    ]
    const names = await resolveNames('NFL', ['1'], 800)
    expect(names.get('1')).toMatchObject({ name: 'New Name', team: 'NEW' })
  })

  it('only the sport asked for is read', async () => {
    state.players = [player({ sport: 'NBA', externalId: 'sleeper:2', sleeperId: '2', name: 'Wrong Sport' })]
    const names = await resolveNames('NFL', ['2'], 800)
    expect(names.has('2')).toBe(false)
  })
})

describe('resolveNames — a provider id is used only when its format names its space', () => {
  it('a namespaced id (tsdb_…) resolves against externalId', async () => {
    state.players = [player({ externalId: 'tsdb_34145937', source: 'thesportsdb', name: 'Named By TSDB' })]
    const names = await resolveNames('NFL', ['tsdb_34145937'], 800)
    expect(names.get('tsdb_34145937')?.name).toBe('Named By TSDB')
  })

  it('a name the Sleeper space found is not overwritten by a provider row', async () => {
    state.players = [
      player({ externalId: 'sleeper:55', sleeperId: '55', name: 'Right Person' }),
      player({ externalId: '55', source: 'cfbd', name: 'Wrong Person', fetchedAt: 99 }),
    ]
    const names = await resolveNames('NFL', ['55'], 800)
    expect(names.get('55')?.name).toBe('Right Person')
  })
})

describe('resolveNames — a whole league, and nothing but what was asked', () => {
  it('🛑 names 450 players with two rows each — no row cap below the league', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(10_000 + i))
    state.players = ids.flatMap((id) => [
      player({ externalId: `sleeper:${id}`, sleeperId: id, name: `Player ${id}`, fetchedAt: 2 }),
      player({ externalId: `sleeper:${id}`, sleeperId: id, name: `Player ${id} (older)`, fetchedAt: 1 }),
    ])
    const names = await resolveNames('NFL', ids, 800)
    expect(names.size).toBe(450)
    expect(names.get('10449')?.name).toBe('Player 10449')
    for (const q of state.playerQueries) expect(q.take).toBeUndefined()
  })

  it('never adds keys nobody asked for', async () => {
    state.players = [
      player({ externalId: 'sleeper:3', sleeperId: '3', name: 'Three' }),
      player({ externalId: 'tsdb_9', sleeperId: '4', name: 'Four by tsdb' }),
      // Reached by its `sleeper:5` spelling, but its sleeperId column says 500 — nobody asked for 500.
      player({ externalId: 'sleeper:5', sleeperId: '500', name: 'Five' }),
    ]
    const names = await resolveNames('NFL', ['3', '5', 'tsdb_9'], 800)
    expect([...names.keys()].sort()).toEqual(['3', '5', 'tsdb_9'])
  })

  it('the SportsPlayerRecord pass still answers first for an id written in its own form', async () => {
    state.records = [{ id: 'NFL:4017', sport: 'NFL', name: 'From Records', position: 'QB', team: 'KC', injuryStatus: null }]
    state.players = [player({ externalId: 'NFL:4017', name: 'From Players' })]
    const names = await resolveNames('NFL', ['NFL:4017'], 800)
    expect(names.get('NFL:4017')?.name).toBe('From Records')
    expect(state.playerQueries).toHaveLength(0)
  })

  it('still honours `limit`', async () => {
    const ids = ['a1', 'a2', 'a3'].map((s) => `tsdb_${s}`)
    state.players = ids.map((id) => player({ externalId: id, source: 'thesportsdb', name: id }))
    const names = await resolveNames('NFL', ids, 2)
    expect(names.size).toBe(2)
  })
})
