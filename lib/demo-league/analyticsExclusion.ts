/**
 * Keep "Create a test league" leagues out of real-league analytics.
 *
 * A test league is marked `League.settings.isTestLeague = true` by
 * `fillTestLeagueWithPlaceholders`. The PUBLIC DEMO itself needs nothing here: it is a
 * read-through view, so it creates no League, AppUser or import row to exclude.
 *
 * 🛑 SUBTRACT A POSITIVE MATCH; NEVER FILTER WITH `NOT` ON A JSON PATH. In Postgres
 * `NOT (settings #> '{isTestLeague}' = 'true')` is NULL — not true — for every league
 * whose settings lack the key or are NULL, so a `NOT` filter silently drops almost every
 * real league from the count. Counting the positive set (`equals: true`, which is
 * unambiguous) and subtracting it cannot under-count real leagues.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const TEST_LEAGUE_WHERE: Prisma.LeagueWhereInput = { settings: { path: ['isTestLeague'], equals: true } }

function andTest(where: Prisma.LeagueWhereInput | undefined): Prisma.LeagueWhereInput {
  return where && Object.keys(where).length > 0 ? { AND: [where, TEST_LEAGUE_WHERE] } : TEST_LEAGUE_WHERE
}

/** `league.count(where)` minus test leagues. Fails toward the plain total if the subtraction query fails. */
export async function countRealLeagues(where?: Prisma.LeagueWhereInput): Promise<number> {
  const [total, tests] = await Promise.all([
    prisma.league.count({ where: where ?? {} }),
    prisma.league.count({ where: andTest(where) }).catch(() => 0),
  ])
  return Math.max(0, total - tests)
}

/** Count of test leagues per value of `key`, for subtracting from a `groupBy` over the same `where`. */
export async function testLeagueCountsBy<K extends 'sport' | 'platform'>(
  key: K,
  where?: Prisma.LeagueWhereInput,
): Promise<Map<string, number>> {
  const rows = await prisma.league
    .groupBy({ by: [key], _count: { id: true }, where: andTest(where) })
    .catch(() => [] as Array<Record<string, unknown> & { _count: { id: number } }>)
  const out = new Map<string, number>()
  for (const r of rows as Array<Record<string, unknown> & { _count: { id: number } }>) out.set(String(r[key]), r._count.id)
  return out
}

/** Test leagues created per UTC day (YYYY-MM-DD) inside `where`. */
export async function testLeagueCreatedDays(where: Prisma.LeagueWhereInput): Promise<Map<string, number>> {
  const rows = await prisma.league.findMany({ where: andTest(where), select: { createdAt: true } }).catch(() => [])
  const out = new Map<string, number>()
  for (const r of rows) {
    const k = r.createdAt.toISOString().slice(0, 10)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}
