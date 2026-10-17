import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `sports_players.injury_status` on rows the importer did NOT rewrite.
 *
 * Measured in production 2026-10-11: rows untouched since the write-path fix (e71912b3) still held
 * 80,923 NCAAF / 22,509 NCAAB / 19,409 NFL roster codes and 811 NFL designations nobody reported any
 * more (391 "Questionable" last written 2026-09-28, data_source 'cached'). They survive two ways —
 * orphan ids no seed produces any more, and a sport whose upsert throws — and the column guard has
 * to hold whoever wrote the value.
 *
 * The prisma double below keeps a tiny in-memory `sports_players`. Upserts stamp `lastUpdated` the
 * way `@updatedAt` does, `updateMany` bumps it the way Prisma does, and `$executeRaw` applies the
 * statement's predicate — which the tests ALSO pin textually, so the double cannot drift from the SQL.
 */

type Row = {
  id: string
  sport: string
  injuryStatus: string | null
  injuryNotes: string | null
  lastUpdated: Date
  dataSource: string
}

const h = vi.hoisted(() => ({
  table: new Map<string, any>(),
  raw: [] as Array<{ sql: string; values: unknown[]; at: number }>,
  upsertTimes: [] as number[],
  written: new Map<string, [unknown, unknown]>(),
  updateManyAt: [] as number[],
  failUpsert: false,
  failRaw: false,
  identity: [] as any[],
  live: [] as any[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/api-chain', () => ({
  apiChain: { fetch: vi.fn(async () => ({ data: [], source: 'cache', latency: 0, cached: false })) },
}))
vi.mock('@/lib/prisma', () => {
  const empty = { findMany: async () => [] }
  const parseCutoff = (s: string) => new Date(`${s.replace(' ', 'T')}Z`)
  return {
    prisma: {
      sportsTeam: empty,
      sportsPlayer: empty,
      playerSeasonStats: empty,
      injuryReportRecord: empty,
      playerNewsRecord: empty,
      adpDataRecord: empty,
      playerMetaTrend: empty,
      syncJobRun: { findFirst: async () => null },
      playerIdentityMap: { findMany: async ({ where }: any) => h.identity.filter((r) => r.sport === where.sport) },
      sportsInjury: { findMany: async ({ where }: any) => h.live.filter((r) => r.sport === where.sport) },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      sportsPlayerRecord: {
        upsert: async ({ where, update, create }: any) => {
          if (h.failUpsert) throw new Error('batch exploded')
          const now = Date.now()
          h.upsertTimes.push(now)
          h.written.set(where.id, [update.injuryStatus, update.injuryNotes])
          const prev = h.table.get(where.id)
          const next = { ...(prev ?? create), ...(prev ? update : {}), id: where.id, lastUpdated: new Date(now) }
          h.table.set(where.id, next)
          return next
        },
        updateMany: async ({ where, data }: any) => {
          h.updateManyAt.push(h.raw.length)
          let n = 0
          for (const row of h.table.values()) {
            if (row.sport !== where.sport || !(row.lastUpdated < where.lastUpdated.lt)) continue
            Object.assign(row, data, { lastUpdated: new Date() }) // @updatedAt: Prisma bumps it
            n += 1
          }
          return { count: n }
        },
        groupBy: async ({ where }: any) => {
          expect(where).toEqual({ injuryStatus: { not: null } })
          const seen = new Set<string>()
          for (const row of h.table.values()) if (row.injuryStatus != null) seen.add(row.injuryStatus)
          return [...seen].map((injuryStatus) => ({ injuryStatus }))
        },
      },
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ').trim()
        h.raw.push({ sql, values, at: Date.now() })
        if (h.failRaw) throw new Error('raw failed')
        let n = 0
        const clear = (row: Row) => {
          row.injuryStatus = null
          row.injuryNotes = null
          n += 1
        }
        if (sql.includes('"sport" = ?')) {
          const [sport, cutoff] = values as [string, string]
          for (const row of h.table.values()) {
            if (row.sport === sport && row.lastUpdated < parseCutoff(cutoff) && (row.injuryStatus != null || row.injuryNotes != null)) clear(row)
          }
        } else if (sql.includes('= ANY(?::text[])')) {
          const [bad] = values as [string[]]
          for (const row of h.table.values()) {
            if ((row.injuryStatus != null && bad.includes(row.injuryStatus)) || (row.injuryStatus == null && row.injuryNotes != null)) clear(row)
          }
        } else {
          throw new Error(`unexpected raw SQL: ${sql}`)
        }
        return n
      },
    },
  }
})

const DAY = 86_400_000
const H = 3_600_000

function seed(row: Partial<Row> & Pick<Row, 'id' | 'sport'>) {
  h.table.set(row.id, {
    injuryStatus: null,
    injuryNotes: null,
    dataSource: 'rolling_insights',
    lastUpdated: new Date(Date.now() - 34 * DAY),
    name: row.id,
    ...row,
  })
}
const status = (id: string) => h.table.get(id)?.injuryStatus ?? null
const notes = (id: string) => h.table.get(id)?.injuryNotes ?? null
const perSportStatements = () => h.raw.filter((r) => r.sql.includes('"sport" = ?'))
const cutoffOf = (r: { values: unknown[] }) => new Date(`${String(r.values[1]).replace(' ', 'T')}Z`).getTime()

async function run(sports = ['NFL']) {
  const { runSportsDataImporter } = await import('@/lib/workers/sports-data-importer')
  return runSportsDataImporter({ sports })
}

beforeEach(() => {
  h.table.clear()
  h.raw.length = 0
  h.upsertTimes.length = 0
  h.written.clear()
  h.updateManyAt.length = 0
  h.failUpsert = false
  h.failRaw = false
  h.identity = [
    { sport: 'NFL', canonicalName: 'Malik Nabers', currentTeam: 'NYG', position: 'WR', sleeperId: '9999', clearSportsId: null, status: 'INACT' },
    { sport: 'NFL', canonicalName: 'Tank Dell', currentTeam: 'HOU', position: 'WR', sleeperId: '1234', clearSportsId: null, status: 'Injured Reserve' },
  ]
  h.live = [
    {
      sport: 'NFL',
      playerName: 'Malik Nabers',
      team: 'New York Giants',
      position: 'WR',
      status: 'Questionable',
      description: 'Hamstring; limited Friday.',
      date: new Date(Date.now() - 10 * H),
      fetchedAt: new Date(Date.now() - H / 2),
    },
  ]
})

describe('after a successful upsert: rows the run did not write', () => {
  it('clears orphan rows of the sport and keeps every row written this run', async () => {
    seed({ id: 'NFL:9999', sport: 'NFL', injuryStatus: 'INACT' }) // re-written this run
    seed({ id: 'NFL:1234', sport: 'NFL', injuryStatus: 'Out' }) // re-written this run → IR
    seed({ id: 'NFL:malik-nabers:NYG', sport: 'NFL', injuryStatus: 'INACT', dataSource: 'cached' }) // orphan, 2026-09-07 shape
    seed({ id: 'NFL:old-q', sport: 'NFL', injuryStatus: 'Questionable', injuryNotes: 'Knee', dataSource: 'cached', lastUpdated: new Date(Date.now() - 13 * DAY) })
    seed({ id: 'NBA:77', sport: 'NBA', injuryStatus: 'Out' }) // another sport, not run: untouched

    const result = await run(['NFL'])

    expect(status('NFL:9999')).toBe('Questionable')
    expect(notes('NFL:9999')).toBe('Hamstring; limited Friday.')
    expect(status('NFL:1234')).toBe('IR')
    expect(status('NFL:malik-nabers:NYG')).toBeNull()
    expect([status('NFL:old-q'), notes('NFL:old-q')]).toEqual([null, null])
    expect(status('NBA:77')).toBe('Out')
    expect(result.injuryCleanup.unwrittenCleared).toEqual({ NFL: 2 })
  })

  it('cuts off BEFORE the first write of the sport, so no row written this run can match', async () => {
    seed({ id: 'NFL:orphan', sport: 'NFL', injuryStatus: 'Doubtful' })
    await run(['NFL'])

    const [stmt] = perSportStatements()
    expect(stmt).toBeDefined()
    expect(stmt.values[0]).toBe('NFL')
    expect(h.upsertTimes.length).toBeGreaterThan(0)
    expect(cutoffOf(stmt)).toBeLessThan(Math.min(...h.upsertTimes))
    // it runs after the writes, not before them
    expect(stmt.at).toBeGreaterThanOrEqual(Math.max(...h.upsertTimes))
  })

  it('compares a zone-less UTC timestamp and never writes last_updated', async () => {
    seed({ id: 'NFL:orphan', sport: 'NFL', injuryStatus: 'Doubtful' })
    await run(['NFL'])
    const [stmt] = perSportStatements()
    expect(stmt.sql).toContain('UPDATE "sports_players" SET "injury_status" = NULL, "injury_notes" = NULL WHERE "sport" = ?')
    expect(stmt.sql).toContain('"last_updated" < ?::timestamp(3)')
    expect(stmt.sql).toContain('("injury_status" IS NOT NULL OR "injury_notes" IS NOT NULL)')
    expect(stmt.sql.split('WHERE')[0]).not.toContain('last_updated')
    expect(String(stmt.values[1])).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/)
  })

  it('does not clear a sport that wrote nothing', async () => {
    h.identity = []
    h.live = []
    seed({ id: 'NFL:orphan', sport: 'NFL', injuryStatus: 'Doubtful' })
    await run(['NFL'])
    expect(perSportStatements()).toHaveLength(0)
    expect(status('NFL:orphan')).toBe('Doubtful')
  })
})

describe('when a sport upsert fails', () => {
  it('clears designations older than the TTL, keeps the previous run\'s, and still relabels dataSource', async () => {
    h.failUpsert = true
    seed({ id: 'NFL:stale-q', sport: 'NFL', injuryStatus: 'Questionable', injuryNotes: 'Ankle', lastUpdated: new Date('2026-09-28T12:00:00Z') })
    seed({ id: 'NFL:recent-out', sport: 'NFL', injuryStatus: 'Out', lastUpdated: new Date(Date.now() - 2 * H) })

    const result = await run(['NFL'])

    expect(result.staleFallbackApplied).toBe(true)
    expect([status('NFL:stale-q'), notes('NFL:stale-q')]).toEqual([null, null])
    expect(h.table.get('NFL:stale-q').dataSource).toBe('cached')
    expect(status('NFL:recent-out')).toBe('Out')
    expect(result.injuryCleanup.staleClearedAfterFailure).toEqual({ NFL: 1 })
    expect(result.injuryCleanup.unwrittenCleared).toEqual({})
  })

  it('clears BEFORE the dataSource relabel, whose updateMany bumps lastUpdated and would hide the rows', async () => {
    h.failUpsert = true
    seed({ id: 'NFL:stale-q', sport: 'NFL', injuryStatus: 'Questionable', lastUpdated: new Date('2026-09-28T12:00:00Z') })
    await run(['NFL'])
    const stmtIndex = h.raw.findIndex((r) => r.sql.includes('"sport" = ?'))
    expect(stmtIndex).toBe(0)
    expect(h.updateManyAt).toEqual([1]) // the relabel ran after exactly one raw statement
    // TTL cutoff, not "now"
    expect(Date.now() - cutoffOf(h.raw[0])).toBeGreaterThanOrEqual(6 * H - 5_000)
  })

  it('still clears roster codes on the failed sport through the run-wide guard', async () => {
    h.failUpsert = true
    seed({ id: 'NFL:recent-inact', sport: 'NFL', injuryStatus: 'INACT', lastUpdated: new Date(Date.now() - H) })
    await run(['NFL'])
    expect(status('NFL:recent-inact')).toBeNull()
  })
})

describe('the run-wide guard', () => {
  it('clears every non-designation in every sport, and leaves designations', async () => {
    const fresh = new Date(Date.now() - H)
    const values: Array<[string, string]> = [
      ['NCAAF:1', 'INACT'], ['NCAAB:2', 'ACT'], ['MLB:3', 'Active'], ['NHL:4', 'active'], ['NBA:5', 'Inactive'],
      ['SOCCER:6', 'Unknown'], ['NBA:7', 'Free Agent'], ['NBA:8', 'Retired'], ['NBA:9', 'Hamstring injury'],
      ['NBA:10', 'Out'], ['MLB:11', '60-day IL'], ['NHL:12', 'Day-to-Day'], ['SOCCER:13', 'Suspension'],
    ]
    for (const [id, v] of values) seed({ id, sport: id.split(':')[0], injuryStatus: v, injuryNotes: 'n', lastUpdated: fresh })
    seed({ id: 'NBA:orphan-note', sport: 'NBA', injuryStatus: null, injuryNotes: 'Knee soreness', lastUpdated: fresh })

    const result = await run(['NFL'])

    for (const id of ['NCAAF:1', 'NCAAB:2', 'MLB:3', 'NHL:4', 'NBA:5', 'SOCCER:6', 'NBA:7', 'NBA:8', 'NBA:9']) {
      expect([id, status(id), notes(id)]).toEqual([id, null, null])
    }
    for (const id of ['NBA:10', 'MLB:11', 'NHL:12', 'SOCCER:13']) expect([id, status(id)]).not.toEqual([id, null])
    expect(notes('NBA:orphan-note')).toBeNull()
    expect(result.injuryCleanup.nonDesignationValues).not.toContain('Out')
    expect(result.injuryCleanup.nonDesignationValues).toContain('INACT')
    const guard = h.raw.find((r) => r.sql.includes('= ANY('))!
    expect(guard.sql).toContain('WHERE "injury_status" = ANY(?::text[]) OR ("injury_status" IS NULL AND "injury_notes" IS NOT NULL)')
    expect(guard.sql.split('WHERE')[0]).not.toContain('last_updated')
  })

  it('a cleanup failure is reported, never thrown', async () => {
    h.failRaw = true
    seed({ id: 'NFL:orphan', sport: 'NFL', injuryStatus: 'INACT' })
    const result = await run(['NFL'])
    expect(result.imported).toBeGreaterThan(0)
    expect(result.injuryCleanup.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the write path', () => {
  it('stores no live-feed value that is not a designation', async () => {
    h.live = [{ ...h.live[0], status: 'Knee injury', description: 'MRI pending' }]
    seed({ id: 'NFL:9999', sport: 'NFL', injuryStatus: null })
    await run(['NFL'])
    // the UPSERT payload, not the final table: the run-wide guard would mask a write-path leak
    expect(h.written.get('NFL:9999')).toEqual([null, null])
    expect([status('NFL:9999'), notes('NFL:9999')]).toEqual([null, null])
  })

  it('the resolver itself passes its output through the predicate', async () => {
    const { loadCurrentInjuryResolver } = await import('@/lib/workers/sports-data-importer')
    h.live = [{ ...h.live[0], status: 'Limited', description: 'Practice' }]
    const of = await loadCurrentInjuryResolver('NFL')
    expect(of({ name: 'Malik Nabers', team: 'NYG', position: 'WR', status: 'INACT', source: 'sleeper' })).toEqual({ status: null, notes: null })
  })
})
