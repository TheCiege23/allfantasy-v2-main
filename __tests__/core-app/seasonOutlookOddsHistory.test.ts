// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  readOddsHistory,
  snapshotFromRun,
  snapshotWeek,
  writeOddsSnapshot,
  type OddsSnapshotInput,
} from '@/lib/core-app/seasonOutlookOddsHistory'

/** A fake db whose raw calls are rebuilt into the Prisma.Sql they would send. */
function fakeDb(opts: { execute?: (q: Prisma.Sql) => unknown; query?: (q: Prisma.Sql) => unknown } = {}) {
  const sent: Prisma.Sql[] = []
  const tag = (fn?: (q: Prisma.Sql) => unknown) =>
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = Prisma.sql(strings, ...values)
      sent.push(q)
      return fn ? fn(q) : 0
    })
  const db = { $executeRaw: tag(opts.execute), $queryRaw: tag(opts.query) }
  return { db: db as never, sent }
}

const input: OddsSnapshotInput = {
  pid: 'sleeper:123',
  season: 2026,
  week: 7,
  result: {
    iterations: 10_000,
    computedAt: '2026-10-20T12:00:00Z',
    counts: {
      '1': { playoff: 6_234, bye: 2_000, title: 1_111 },
      '2': { playoff: 9_999, bye: 5_000, title: 3_000 },
      '3': { playoff: 0, bye: 0, title: 0 },
    },
  },
  teams: [
    { rosterId: '1', modelled: true },
    { rosterId: '2', modelled: true },
    { rosterId: '3', modelled: false },
  ],
}

describe('writeOddsSnapshot', () => {
  it('upserts one row per modelled team for the league-week, then prunes seasons before last season', async () => {
    const { db, sent } = fakeDb({ execute: (q) => (q.sql.includes('INSERT') ? 2 : 5) })
    const out = await writeOddsSnapshot(input, { prisma: db })
    expect(out).toEqual({ ok: true, written: 2, pruned: 5 })

    const [insert, prune] = sent
    expect(insert.sql).toContain('INSERT INTO "league_odds_snapshots"')
    expect(insert.sql).toContain('ON CONFLICT ("league_id", "season", "week", "team_external_id")')
    expect(insert.sql).toContain('DO UPDATE SET')
    // Two rows of eight values — the unmodelled team is not written.
    expect(insert.values).toHaveLength(16)
    const rows = [insert.values.slice(0, 8), insert.values.slice(8)]
    expect(rows.map((r) => r.slice(1, 7))).toEqual([
      ['sleeper:123', 2026, 7, '1', 62.34, 11.11],
      ['sleeper:123', 2026, 7, '2', 99.99, 30],
    ])

    // Keep this season and the previous one: delete 2024 and older for this league only.
    expect(prune.sql).toContain('DELETE FROM "league_odds_snapshots"')
    expect(prune.sql).toMatch(/"league_id" = \? AND "season" <= \?/)
    expect(prune.values).toEqual(['sleeper:123', 2024])
  })

  it('swallows a missing table and reports it, never throwing', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError('Raw query failed. Code: `42P01`. Message: `relation "league_odds_snapshots" does not exist`', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '42P01', message: 'relation "league_odds_snapshots" does not exist' },
    })
    const { db } = fakeDb({ execute: () => { throw missing } })
    await expect(writeOddsSnapshot(input, { prisma: db })).resolves.toEqual({ ok: false, written: 0, pruned: 0, reason: 'missing_table' })

    const { db: broken } = fakeDb({ execute: () => { throw new Error('connection reset') } })
    await expect(writeOddsSnapshot(input, { prisma: broken })).resolves.toMatchObject({ ok: false, reason: 'error' })
  })

  it('writes nothing when there is no snapshot or no modelled team', async () => {
    const { db, sent } = fakeDb()
    expect(await writeOddsSnapshot(null, { prisma: db })).toMatchObject({ ok: false, reason: 'no_rows' })
    expect(await writeOddsSnapshot({ ...input, teams: [{ rosterId: '3', modelled: false }] }, { prisma: db })).toMatchObject({ reason: 'no_rows' })
    expect(sent).toHaveLength(0)
  })
})

describe('readOddsHistory', () => {
  const league = { id: 'af-1', platform: 'sleeper', platformLeagueId: '123' }

  it('reads your team by the league scope key and season, oldest week first', async () => {
    const { db, sent } = fakeDb({
      query: () => [
        { week: 5, playoff_pct: 40, title_pct: 5 },
        { week: 6, playoff_pct: 52.5, title_pct: 8 },
      ],
    })
    expect(await readOddsHistory(league, 2026, '7', { prisma: db })).toEqual([
      { week: 5, playoffPct: 40, titlePct: 5 },
      { week: 6, playoffPct: 52.5, titlePct: 8 },
    ])
    expect(sent[0].values).toEqual(['sleeper:123', 2026, '7'])
    expect(sent[0].sql).toContain('ORDER BY "week" ASC')
  })

  it('returns nothing under two weeks, and nothing when the read fails or the table is missing', async () => {
    expect(await readOddsHistory(league, 2026, '7', { prisma: fakeDb({ query: () => [{ week: 5, playoff_pct: 40, title_pct: 5 }] }).db })).toBeNull()
    expect(await readOddsHistory(league, 2026, '7', { prisma: fakeDb({ query: () => [] }).db })).toBeNull()
    const thrower = fakeDb({ query: () => { throw new Error('relation "league_odds_snapshots" does not exist') } }).db
    await expect(readOddsHistory(league, 2026, '7', { prisma: thrower })).resolves.toBeNull()
  })
})

describe('snapshotFromRun', () => {
  const sim = {
    teams: [
      { rosterId: '1', wins: 3, losses: 1, pointsFor: 400, profile: { mu: 100, sigma: 15, n: 4 } },
      { rosterId: '2', wins: 1, losses: 3, pointsFor: 300, profile: null },
    ],
    remaining: [{ week: 6, a: '1', b: '2' }, { week: 5, a: '2', b: '1' }],
  }

  it('files the run under the current period, else the next unplayed week, else the last played one', () => {
    expect(snapshotWeek({ period: 9, sim })).toBe(9)
    expect(snapshotWeek({ sim })).toBe(5)
    expect(snapshotWeek({ sim: { remaining: [] }, played: [{ week: 13, a: '1', b: '2' }, { week: 14, a: '1', b: '2' }] })).toBe(14)
    expect(snapshotWeek({ sim: { remaining: [] } })).toBeNull()
  })

  it('marks which teams are modelled, and returns null rather than throwing on a partial run', () => {
    const snap = snapshotFromRun({ pid: 'sleeper:1', season: 2026, sim }, input.result)
    expect(snap).toMatchObject({ pid: 'sleeper:1', season: 2026, week: 5, teams: [{ rosterId: '1', modelled: true }, { rosterId: '2', modelled: false }] })
    expect(snapshotFromRun({ pid: 'sleeper:1', season: 2026, sim: {} as never }, input.result)).toBeNull()
    expect(snapshotFromRun({ pid: 'sleeper:1', season: 2026, sim }, undefined)).toBeNull()
  })
})
