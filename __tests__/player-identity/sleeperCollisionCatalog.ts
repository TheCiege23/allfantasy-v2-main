/**
 * The real cross-sport Sleeper-id collisions in `SportsPlayer`, as test data, plus a fake
 * `sportsPlayer.findMany` that evaluates the subset of Prisma `where` these reads use.
 *
 * Sleeper numbers each sport's players separately, so one id is two people:
 *
 *   1466  NFL Travis Kelce (TE)       NBA JaVale McGee (C)
 *   4866  NFL Saquon Barkley (RB)     NBA AJ Dybantsa (F)
 *   4984  NFL Josh Allen (QB)         NBA Cameron Corhen (F)
 *
 * The NBA rows are listed FIRST and are FRESHER on purpose. That is the production shape that
 * shipped #4298 — the fresher NBA row won — and it means an unscoped read that keeps the first or
 * the freshest row fails these tests, rather than passing by the luck of row order.
 *
 * The fake honours `sport` (string, `{ in }`, `{ equals, mode }`), `sleeperId` (string, `{ in }`,
 * `{ equals }`, `{ not: null }`), `id`, `externalId`, `source`, `OR` and `AND`. An unknown key throws,
 * so a read the fake cannot evaluate fails loudly instead of matching everything.
 */

export type CatalogRow = {
  id: string
  sport: string
  sleeperId: string | null
  externalId: string
  source: string
  name: string
  position: string | null
  team: string | null
  age: number | null
  imageUrl: string | null
  fetchedAt: Date
  updatedAt: Date
}

const fresh = new Date('2026-11-26T12:00:00Z')
const stale = new Date('2026-11-01T12:00:00Z')

function row(sport: string, sleeperId: string, name: string, position: string, team: string, age: number, at: Date): CatalogRow {
  return {
    id: `sp_${sport.toLowerCase()}_${sleeperId}`,
    sport,
    sleeperId,
    externalId: `sleeper:${sleeperId}`,
    source: 'sleeper',
    name,
    position,
    team,
    age,
    imageUrl: `https://sleepercdn.com/content/${sport.toLowerCase()}/players/thumb/${sleeperId}.jpg`,
    fetchedAt: at,
    updatedAt: at,
  }
}

export const COLLISION_ROWS: CatalogRow[] = [
  row('NBA', '1466', 'JaVale McGee', 'C', 'DAL', 38, fresh),
  row('NBA', '4866', 'AJ Dybantsa', 'F', 'UTA', 19, fresh),
  row('NBA', '4984', 'Cameron Corhen', 'F', 'FA', 23, fresh),
  row('NFL', '1466', 'Travis Kelce', 'TE', 'KC', 37, stale),
  row('NFL', '4866', 'Saquon Barkley', 'RB', 'PHI', 29, stale),
  row('NFL', '4984', 'Josh Allen', 'QB', 'BUF', 30, stale),
]

export const NFL_NAME: Record<string, string> = { '1466': 'Travis Kelce', '4866': 'Saquon Barkley', '4984': 'Josh Allen' }
export const NBA_NAME: Record<string, string> = { '1466': 'JaVale McGee', '4866': 'AJ Dybantsa', '4984': 'Cameron Corhen' }

type Cond = unknown

function matchScalar(value: unknown, cond: Cond): boolean {
  if (cond === undefined) return true
  if (cond === null || typeof cond !== 'object') return value === cond
  const c = cond as Record<string, unknown>
  const insensitive = c.mode === 'insensitive'
  const norm = (v: unknown) => (insensitive && typeof v === 'string' ? v.toLowerCase() : v)
  for (const [k, v] of Object.entries(c)) {
    if (k === 'mode') continue
    if (k === 'in') {
      if (!(v as unknown[]).map(norm).includes(norm(value))) return false
    } else if (k === 'equals') {
      if (norm(value) !== norm(v)) return false
    } else if (k === 'not') {
      if (v === null ? value == null : matchScalar(value, v)) return false
    } else throw new Error(`sleeperCollisionCatalog: unsupported operator ${k}`)
  }
  return true
}

export function matchesWhere(r: CatalogRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue
    if (k === 'OR') {
      if (!(v as Record<string, unknown>[]).some((w) => matchesWhere(r, w))) return false
    } else if (k === 'AND') {
      const list = Array.isArray(v) ? v : [v]
      if (!(list as Record<string, unknown>[]).every((w) => matchesWhere(r, w))) return false
    } else if (k === 'NOT') {
      if (matchesWhere(r, v as Record<string, unknown>)) return false
    } else if (k in r) {
      if (!matchScalar((r as unknown as Record<string, unknown>)[k], v)) return false
    } else throw new Error(`sleeperCollisionCatalog: unsupported where key ${k}`)
  }
  return true
}

/** A `findMany` over `rows` honouring `where` and a flat `select`. Rows keep catalog order. */
export function fakeFindMany(rows: CatalogRow[] = COLLISION_ROWS) {
  return async (args: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) => {
    const hit = rows.filter((r) => matchesWhere(r, args.where))
    if (!args.select) return hit
    return hit.map((r) =>
      Object.fromEntries(Object.entries(args.select!).filter(([, on]) => on).map(([k]) => [k, (r as unknown as Record<string, unknown>)[k]])),
    )
  }
}
