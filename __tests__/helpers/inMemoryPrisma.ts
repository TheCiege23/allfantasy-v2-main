/**
 * A generic in-memory Prisma stand-in for season-length simulations, so the REAL DB-backed engines
 * (matchup scoring, standings, waivers, the playoff bracket, the next-season shell) run end to end
 * without a database.
 *
 * 🛑 TEST-ONLY. Mock `@/lib/prisma` with `inMemoryPrisma.client`; nothing here can reach Postgres, and
 * the vitest DATABASE_URL pin (vitest.setup.db-guard.ts) stays in force underneath it.
 *
 * Fidelity is deliberately narrow — what the redraft engines actually use:
 *   - `where`: equality, `null`, `{ in, notIn, not, lt, lte, gt, gte, equals }`, `OR` / `AND` / `NOT`,
 *     compound unique keys (`playerId_week_season_sport: {...}`) and to-one relation filters listed in
 *     `RELATIONS` (`roster: { seasonId }`).
 *   - `include` / `select` of the relations in `RELATIONS` (nested `include`, `orderBy`); scalars are
 *     always returned whole, which no engine here can tell apart from a narrower select.
 *   - `orderBy` (object or array, `{ sort, nulls }`), `take`, `skip`.
 *   - `create` / `createMany` / `update` / `updateMany` / `upsert` / `delete` / `deleteMany` / `count`,
 *     `groupBy` (by, where, _max, _min, _count._all),
 *     with the schema defaults in `DEFAULTS` and `{ increment, decrement, set }` updates.
 *   - `$transaction(fn | array)` runs against the same store (no rollback); raw SQL returns nothing.
 * Any model nobody seeded reads as empty, so optional side paths (devy, c2c, survivor, feeds) no-op.
 */

type Row = Record<string, any>

type Relation = { model: string; kind: 'one' | 'many'; local: string; foreign: string }

const RELATIONS: Record<string, Record<string, Relation>> = {
  redraftSeason: {
    league: { model: 'league', kind: 'one', local: 'leagueId', foreign: 'id' },
    rosters: { model: 'redraftRoster', kind: 'many', local: 'id', foreign: 'seasonId' },
    playoffBracket: { model: 'redraftPlayoffBracket', kind: 'one', local: 'id', foreign: 'seasonId' },
    playoffRounds: { model: 'redraftPlayoffRound', kind: 'many', local: 'id', foreign: 'seasonId' },
    schedule: { model: 'redraftMatchup', kind: 'many', local: 'id', foreign: 'seasonId' },
  },
  redraftRoster: {
    players: { model: 'redraftRosterPlayer', kind: 'many', local: 'id', foreign: 'rosterId' },
    season: { model: 'redraftSeason', kind: 'one', local: 'seasonId', foreign: 'id' },
  },
  redraftRosterPlayer: {
    roster: { model: 'redraftRoster', kind: 'one', local: 'rosterId', foreign: 'id' },
  },
  redraftMatchup: {
    homeRoster: { model: 'redraftRoster', kind: 'one', local: 'homeRosterId', foreign: 'id' },
    awayRoster: { model: 'redraftRoster', kind: 'one', local: 'awayRosterId', foreign: 'id' },
    season: { model: 'redraftSeason', kind: 'one', local: 'seasonId', foreign: 'id' },
    league: { model: 'league', kind: 'one', local: 'leagueId', foreign: 'id' },
  },
  redraftPlayoffRound: {
    matchups: { model: 'redraftPlayoffMatchup', kind: 'many', local: 'id', foreign: 'roundId' },
  },
  redraftWaiverClaim: {
    roster: { model: 'redraftRoster', kind: 'one', local: 'rosterId', foreign: 'id' },
    season: { model: 'redraftSeason', kind: 'one', local: 'seasonId', foreign: 'id' },
  },
  league: {
    teams: { model: 'leagueTeam', kind: 'many', local: 'id', foreign: 'leagueId' },
    rosters: { model: 'roster', kind: 'many', local: 'id', foreign: 'leagueId' },
    leagueEntrySlots: { model: 'leagueEntrySlot', kind: 'many', local: 'id', foreign: 'leagueId' },
    leagueSettings: { model: 'leagueSettings', kind: 'one', local: 'id', foreign: 'leagueId' },
  },
}

/** Schema defaults (prisma/schema.prisma) for the models the engines create. */
const DEFAULTS: Record<string, () => Row> = {
  redraftSeason: () => ({ status: 'setup', currentWeek: 0, medianGame: false }),
  redraftRoster: () => ({
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    streak: null,
    playoffSeed: null,
    faabBalance: 100,
    waiverPriority: 0,
    isEliminated: false,
    teamName: null,
    avatarUrl: null,
  }),
  redraftRosterPlayer: () => ({
    isLocked: false,
    injuryStatus: null,
    byeWeek: null,
    addedAt: new Date(),
    droppedAt: null,
    acquisitionType: 'drafted',
    isKept: false,
    team: null,
  }),
  redraftMatchup: () => ({
    type: 'regular',
    awayRosterId: null,
    homeScore: 0,
    awayScore: 0,
    status: 'scheduled',
    isMedianMatchup: false,
    medianScore: null,
    lineupSnapshots: null,
  }),
  redraftWaiverClaim: () => ({ status: 'pending', submittedAt: new Date(), processedAt: null, denialReason: null }),
  redraftPlayoffRound: () => ({ status: 'pending', bracketId: null, roundName: null }),
  redraftPlayoffMatchup: () => ({
    homeRosterId: null,
    awayRosterId: null,
    homeSeed: null,
    awaySeed: null,
    homeScore: null,
    awayScore: null,
    winnerRosterId: null,
    nextMatchupId: null,
    status: 'scheduled',
    metadata: {},
  }),
  redraftPlayoffBracket: () => ({ status: 'pending' }),
}

const OPERATORS = new Set(['in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'equals', 'contains', 'startsWith', 'mode'])

function isPlainObject(value: unknown): value is Row {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value
}

function sameValue(a: unknown, b: unknown): boolean {
  return comparable(a) === comparable(b) || (a == null && b == null)
}

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (Array.isArray(value)) return value.map(clone) as T
  if (isPlainObject(value)) {
    const out: Row = {}
    for (const [k, v] of Object.entries(value)) out[k] = clone(v)
    return out as T
  }
  return value
}

export type InMemoryPrisma = {
  /** Pass as `prisma` to `vi.mock('@/lib/prisma', ...)`. */
  client: any
  /** The raw tables, for seeding and for assertions. */
  tables: Map<string, Row[]>
  table: (model: string) => Row[]
  reset: () => void
}

export function createInMemoryPrisma(): InMemoryPrisma {
  const tables = new Map<string, Row[]>()
  let idCounter = 0
  const table = (model: string): Row[] => {
    let rows = tables.get(model)
    if (!rows) {
      rows = []
      tables.set(model, rows)
    }
    return rows
  }

  function matchOperator(value: unknown, condition: Row): boolean {
    for (const [op, expected] of Object.entries(condition)) {
      const v = comparable(value) as any
      const e = comparable(expected) as any
      switch (op) {
        case 'equals':
          if (!sameValue(value, expected)) return false
          break
        case 'in':
          if (!(expected as unknown[]).some((x) => sameValue(value, x))) return false
          break
        case 'notIn':
          if ((expected as unknown[]).some((x) => sameValue(value, x))) return false
          break
        case 'not':
          if (isPlainObject(expected) ? matchOperator(value, expected) : sameValue(value, expected)) return false
          break
        case 'lt':
          if (!(v != null && v < e)) return false
          break
        case 'lte':
          if (!(v != null && v <= e)) return false
          break
        case 'gt':
          if (!(v != null && v > e)) return false
          break
        case 'gte':
          if (!(v != null && v >= e)) return false
          break
        case 'contains':
          if (!String(value ?? '').includes(String(expected))) return false
          break
        case 'startsWith':
          if (!String(value ?? '').startsWith(String(expected))) return false
          break
        default:
          break
      }
    }
    return true
  }

  function matches(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true
    for (const [key, condition] of Object.entries(where)) {
      if (condition === undefined) continue
      if (key === 'OR') {
        if (!(condition as Row[]).some((c) => matches(model, row, c))) return false
        continue
      }
      if (key === 'AND') {
        const list = Array.isArray(condition) ? condition : [condition]
        if (!list.every((c) => matches(model, row, c))) return false
        continue
      }
      if (key === 'NOT') {
        const list = Array.isArray(condition) ? condition : [condition]
        if (list.some((c) => matches(model, row, c))) return false
        continue
      }
      const relation = RELATIONS[model]?.[key]
      if (relation) {
        const related = relate(relation, row)
        if (relation.kind === 'one') {
          if (condition === null) {
            if (related != null) return false
          } else if (!related || !matches(relation.model, related as Row, condition as Row)) return false
        } else {
          const list = related as Row[]
          const c = condition as Row
          if (c.some && !list.some((r) => matches(relation.model, r, c.some))) return false
          if (c.none && list.some((r) => matches(relation.model, r, c.none))) return false
          if (c.every && !list.every((r) => matches(relation.model, r, c.every))) return false
        }
        continue
      }
      if (isPlainObject(condition)) {
        const keys = Object.keys(condition)
        if (keys.length > 0 && keys.every((k) => OPERATORS.has(k))) {
          if (!matchOperator(row[key], condition)) return false
          continue
        }
        if (!(key in row)) {
          // Compound unique key: `a_b: { a, b }`.
          if (!matches(model, row, condition)) return false
          continue
        }
        // A JSON column compared whole.
        if (JSON.stringify(row[key]) !== JSON.stringify(condition)) return false
        continue
      }
      if (!sameValue(row[key], condition)) return false
    }
    return true
  }

  function relate(relation: Relation, row: Row): Row | Row[] | null {
    const rows = table(relation.model)
    if (relation.kind === 'one') return rows.find((r) => row[relation.local] != null && sameValue(r[relation.foreign], row[relation.local])) ?? null
    return rows.filter((r) => sameValue(r[relation.foreign], row[relation.local]))
  }

  function sortRows(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows
    const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o as Row))
    return [...rows].sort((a, b) => {
      for (const [field, spec] of specs) {
        if (isPlainObject(spec) && !('sort' in spec)) continue // relation orderBy: not modelled
        const dir = (isPlainObject(spec) ? spec.sort : spec) === 'desc' ? -1 : 1
        const nulls = isPlainObject(spec) ? spec.nulls : undefined
        const av = comparable(a[field]) as any
        const bv = comparable(b[field]) as any
        if (av == null && bv == null) continue
        if (av == null) return nulls === 'first' ? -1 : nulls === 'last' ? 1 : dir === 1 ? 1 : -1
        if (bv == null) return nulls === 'first' ? 1 : nulls === 'last' ? -1 : dir === 1 ? -1 : 1
        if (av < bv) return -dir
        if (av > bv) return dir
      }
      return 0
    })
  }

  function project(model: string, row: Row, args: Row | undefined): Row {
    const out = clone(row)
    const shape = (args?.include ?? args?.select) as Row | undefined
    if (!shape) return out
    for (const [key, spec] of Object.entries(shape)) {
      const relation = RELATIONS[model]?.[key]
      if (!relation || !spec) continue
      const nested = isPlainObject(spec) ? spec : undefined
      const related = relate(relation, row)
      if (relation.kind === 'one') {
        out[key] = related ? project(relation.model, related as Row, nested) : null
      } else {
        let list = (related as Row[]).filter((r) => matches(relation.model, r, nested?.where))
        list = sortRows(list, nested?.orderBy)
        out[key] = list.map((r) => project(relation.model, r, nested))
      }
    }
    return out
  }

  function applyData(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue
      if (isPlainObject(value) && ('increment' in value || 'decrement' in value || 'set' in value || 'multiply' in value)) {
        if ('set' in value) row[key] = value.set
        if ('increment' in value) row[key] = Number(row[key] ?? 0) + Number(value.increment)
        if ('decrement' in value) row[key] = Number(row[key] ?? 0) - Number(value.decrement)
        if ('multiply' in value) row[key] = Number(row[key] ?? 0) * Number(value.multiply)
        continue
      }
      // Nested relation writes (connect/create) are not modelled; scalar foreign keys are.
      if (isPlainObject(value) && ('connect' in value || 'create' in value || 'connectOrCreate' in value)) {
        const connect = (value as Row).connect as Row | undefined
        if (connect?.id && !(`${key}Id` in row)) row[`${key}Id`] = connect.id
        continue
      }
      row[key] = clone(value)
    }
    row.updatedAt = new Date()
  }

  function createRow(model: string, data: Row): Row {
    const now = new Date()
    const row: Row = { ...(DEFAULTS[model]?.() ?? {}), createdAt: now, updatedAt: now }
    applyData(row, data)
    if (row.id == null) row.id = `${model}-${++idCounter}`
    table(model).push(row)
    return row
  }

  function delegate(model: string) {
    const findMany = (args: Row = {}) => {
      let rows = table(model).filter((r) => matches(model, r, args.where))
      rows = sortRows(rows, args.orderBy)
      if (args.skip) rows = rows.slice(args.skip)
      if (args.take != null) rows = args.take >= 0 ? rows.slice(0, args.take) : rows.slice(args.take)
      return rows.map((r) => project(model, r, args))
    }
    const findFirst = (args: Row = {}) => findMany({ ...args, take: 1 })[0] ?? null
    const updateOne = (args: Row) => {
      const row = table(model).find((r) => matches(model, r, args.where))
      if (!row) throw Object.assign(new Error(`${model}.update: record not found`), { code: 'P2025' })
      applyData(row, args.data)
      return project(model, row, args)
    }
    return {
      findMany: async (args?: Row) => findMany(args),
      findFirst: async (args?: Row) => findFirst(args),
      findUnique: async (args?: Row) => findFirst(args),
      findFirstOrThrow: async (args?: Row) => {
        const row = findFirst(args)
        if (!row) throw Object.assign(new Error(`${model} not found`), { code: 'P2025' })
        return row
      },
      findUniqueOrThrow: async (args?: Row) => {
        const row = findFirst(args)
        if (!row) throw Object.assign(new Error(`${model} not found`), { code: 'P2025' })
        return row
      },
      count: async (args: Row = {}) => table(model).filter((r) => matches(model, r, args.where)).length,
      create: async (args: Row) => project(model, createRow(model, args.data), args),
      createMany: async (args: Row) => {
        const list = Array.isArray(args.data) ? args.data : [args.data]
        for (const data of list) createRow(model, data)
        return { count: list.length }
      },
      update: async (args: Row) => updateOne(args),
      updateMany: async (args: Row) => {
        const rows = table(model).filter((r) => matches(model, r, args.where))
        for (const row of rows) applyData(row, args.data)
        return { count: rows.length }
      },
      upsert: async (args: Row) => {
        const row = table(model).find((r) => matches(model, r, args.where))
        if (row) {
          applyData(row, args.update)
          return project(model, row, args)
        }
        return project(model, createRow(model, args.create), args)
      },
      delete: async (args: Row) => {
        const rows = table(model)
        const index = rows.findIndex((r) => matches(model, r, args.where))
        if (index < 0) throw Object.assign(new Error(`${model}.delete: record not found`), { code: 'P2025' })
        const [row] = rows.splice(index, 1)
        return row
      },
      deleteMany: async (args: Row = {}) => {
        const rows = table(model)
        const keep = rows.filter((r) => !matches(model, r, args.where))
        const count = rows.length - keep.length
        tables.set(model, keep)
        return { count }
      },
      aggregate: async () => ({ _sum: {}, _max: {}, _min: {}, _count: 0 }),
      /*
       * `by` + `where`, with `_max` / `_min` of fields and `_count: { _all: true }` (phase 11). Enough for
       * "the newest row per roster" reads; any other aggregate shape is not modelled.
       */
      groupBy: async (args: Row = {}) => {
        const by: string[] = Array.isArray(args.by) ? args.by : [args.by]
        const groups = new Map<string, Row[]>()
        for (const r of table(model).filter((row) => matches(model, row, args.where))) {
          const key = JSON.stringify(by.map((f) => r[f] ?? null))
          groups.set(key, [...(groups.get(key) ?? []), r])
        }
        const pick = (rows: Row[], field: string, dir: 1 | -1) =>
          rows.reduce<unknown>((best, r) => {
            const v = r[field]
            if (v == null) return best
            if (best == null) return v
            const a = v instanceof Date ? v.getTime() : (v as number)
            const b = best instanceof Date ? best.getTime() : (best as number)
            return (a - b) * dir > 0 ? v : best
          }, null)
        return [...groups.values()].map((rows) => {
          const out: Row = {}
          for (const f of by) out[f] = rows[0]![f] ?? null
          if (args._max) out._max = Object.fromEntries(Object.keys(args._max).map((f) => [f, pick(rows, f, 1)]))
          if (args._min) out._min = Object.fromEntries(Object.keys(args._min).map((f) => [f, pick(rows, f, -1)]))
          if (args._count) out._count = { _all: rows.length }
          return out
        })
      },
    }
  }

  const delegates = new Map<string, ReturnType<typeof delegate>>()
  const client: any = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'then') return undefined
        if (prop === '$transaction') {
          return async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(client) : Promise.all(arg as unknown[]))
        }
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe') return async () => []
        if (prop === '$executeRaw' || prop === '$executeRawUnsafe') return async () => 0
        if (prop.startsWith('$')) return async () => undefined
        let d = delegates.get(prop)
        if (!d) {
          d = delegate(prop)
          delegates.set(prop, d)
        }
        return d
      },
    },
  )

  return {
    client,
    tables,
    table,
    reset: () => {
      tables.clear()
      idCounter = 0
    },
  }
}

/** The one store a test file mocks `@/lib/prisma` with (module-level, so the mock and the test share it). */
export const inMemoryPrisma = createInMemoryPrisma()
