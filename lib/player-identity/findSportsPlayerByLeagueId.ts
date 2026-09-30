import 'server-only'

import { prisma } from '@/lib/prisma'

import { leagueIdSpaces, mayBeSleeperId, nonSleeperExternalIdWhere, sleeperIdWhere } from './externalIdNamespace'

/**
 * Resolve the ids a LEAGUE uses to `SportsPlayer` rows, authoritative match first.
 *
 * ⚠ ROSTER IDS ARE SLEEPER IDS AND `externalId` IS NOT THE SLEEPER SPACE. Matching one against
 * the other returns a stranger: `SportsPlayer.externalId` is 83% bare numerics written by Rolling
 * Insights, CFBD and api_football, and 42,032 of those collide with a Sleeper id where 42,031 are
 * a DIFFERENT PERSON — one coincidental true match in the whole table.
 *
 * ⚠ IN AUTOCOACH THAT COLLISION MOVES A LINEUP. These rows carry `status`, and the engine benches
 * a starter it believes is out. A colliding row means benching a healthy player on a stranger's
 * injury — a silent, automated, wrong decision rather than a wrong label on a screen.
 *
 * ⚠ ORDER, NOT EXCLUSION, BECAUSE ONLY NFL HAS BOTH SPACES. `sleeperId` is populated for NFL rows
 * and essentially nowhere else, so for NCAAF, MLB, NHL and the rest a bare `externalId` IS the
 * right key and there is nothing to collide with. Asking the Sleeper space first fixes NFL
 * without breaking every other sport: a real Sleeper row now always wins, and the fallback runs
 * only where nothing in the Sleeper space claims the id.
 *
 * 🛑 AND THE FALLBACK NEVER TAKES AN ID THAT CAN BE A SLEEPER ID (2026-09-29). "Only where nothing
 * claims it" was not enough: an NFL Sleeper id with no Sleeper row — a rookie the feed has not
 * picked up, a retired id — fell through to `externalId` and found Rolling Insights' player of that
 * number instead (Sleeper 9228 is Bryce Young; RI 9228 is an offensive tackle). An unclaimed NFL
 * number now resolves to NOTHING, and AutoCoach leaves that starter alone rather than benching him
 * on a stranger's status. Self-describing ids (`name:…`, `tsdb_…`) and every other sport's numbers
 * still take the fallback — `nonSleeperExternalIdWhere` owns that rule.
 */

type SportsPlayerRow = Awaited<ReturnType<typeof prisma.sportsPlayer.findFirst>>

/** The bare Sleeper id a row answers to, or null if it is not in the Sleeper space. */
export function sleeperKeyOf(row: {
  sleeperId?: string | null
  externalId: string
}): string | null {
  if (row.sleeperId) return row.sleeperId
  return row.externalId.startsWith('sleeper:') ? row.externalId.slice('sleeper:'.length) : null
}

/**
 * One league id to its row. Newest row wins, matching the `orderBy: { updatedAt: 'desc' }` the
 * status call sites already relied on to pick between duplicates.
 */
export async function findSportsPlayerByLeagueId(
  sport: string,
  leaguePlayerId: string,
): Promise<SportsPlayerRow> {
  const sk = sport.toUpperCase()
  const authoritative = await prisma.sportsPlayer.findFirst({
    where: sleeperIdWhere([leaguePlayerId], sk),
    orderBy: { updatedAt: 'desc' },
  })
  if (authoritative) return authoritative
  if (mayBeSleeperId(leaguePlayerId, sk)) return null
  return prisma.sportsPlayer.findFirst({
    where: nonSleeperExternalIdWhere([leaguePlayerId], sk),
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Many league ids to their rows, keyed by the id the CALLER asked with.
 *
 * Keying by the caller's id rather than by `row.externalId` is deliberate: the resolved row's own
 * id is in the provider space, so a map keyed on it cannot be read back with a roster id. That
 * mismatch is how the trending hops in `waiver-intelligence` ended up deduplicating in a
 * different space from the one they were filled from.
 */
export async function findSportsPlayersByLeagueIds(
  sport: string,
  leaguePlayerIds: readonly string[],
): Promise<Map<string, NonNullable<SportsPlayerRow>>> {
  const sk = sport.toUpperCase()
  const ids = [...new Set(leaguePlayerIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  const out = new Map<string, NonNullable<SportsPlayerRow>>()
  if (ids.length === 0) return out

  const keep = (key: string, row: NonNullable<SportsPlayerRow>) => {
    const cur = out.get(key)
    if (!cur || row.updatedAt > cur.updatedAt) out.set(key, row)
  }

  const authoritative = await prisma.sportsPlayer.findMany({ where: sleeperIdWhere(ids, sk) })
  for (const row of authoritative) {
    const key = sleeperKeyOf(row)
    if (key) keep(key, row)
  }

  const unresolved = ids.filter((id) => !out.has(id) && !mayBeSleeperId(id, sk))
  if (unresolved.length > 0) {
    const fallback = await prisma.sportsPlayer.findMany({
      where: nonSleeperExternalIdWhere(unresolved, sk),
    })
    for (const row of fallback) keep(row.externalId, row)
  }

  return out
}

/**
 * `findSportsPlayersByLeagueIds` for a league whose PLATFORM is known, which is the stronger form:
 * the platform decides the space (`leagueIdSpaces`), so no id is ever asked of a column it is not in.
 *
 * ⚠ WHY NOT JUST THE ONE ABOVE. It decides by sport, and that is wrong for a SLEEPER league outside
 * NFL: Sleeper's NBA/MLB/NHL ids are bare numbers, `mayBeSleeperId` says no for them (only NFL rows
 * carry a `sleeperId`), so they fall through to `externalId` and find Rolling Insights' player of
 * that number — a stranger. Here a Sleeper league's ids are only ever Sleeper ids, and an ESPN,
 * Yahoo or other league's ids resolve to NOTHING unless the caller has translated them
 * (`sleeperReadableRosters`, then `{ translated: true }`) — an unnamed player, never a wrong one.
 *
 * Keyed by the id the caller asked with. Where several rows carry one Sleeper id, Sleeper's own row
 * wins (it holds the fantasy-shaped position), then the newest — the rule `indexBySleeperId` uses.
 */
export async function findSportsPlayersForLeague(
  sport: string,
  platform: string | null | undefined,
  leaguePlayerIds: readonly string[],
  opts: { translated?: boolean } = {},
): Promise<Map<string, NonNullable<SportsPlayerRow>>> {
  const sk = sport.toUpperCase()
  const { sleeperIds, providerIds } = leagueIdSpaces(leaguePlayerIds, sk, platform, opts)
  const out = new Map<string, NonNullable<SportsPlayerRow>>()
  const rank = (row: NonNullable<SportsPlayerRow>) => (row.source === 'sleeper' ? 1 : 0)
  const keep = (key: string, row: NonNullable<SportsPlayerRow>) => {
    const cur = out.get(key)
    if (!cur || rank(row) > rank(cur) || (rank(row) === rank(cur) && row.updatedAt > cur.updatedAt)) out.set(key, row)
  }

  const [bySleeper, byProvider] = await Promise.all([
    sleeperIds.length ? prisma.sportsPlayer.findMany({ where: sleeperIdWhere(sleeperIds, sk) }) : [],
    providerIds.length ? prisma.sportsPlayer.findMany({ where: nonSleeperExternalIdWhere(providerIds, sk) }) : [],
  ])
  const askedSleeper = new Set(sleeperIds)
  for (const row of bySleeper) {
    const key = sleeperKeyOf(row)
    if (key && askedSleeper.has(key)) keep(key, row)
  }
  for (const row of byProvider) keep(row.externalId, row)
  return out
}
