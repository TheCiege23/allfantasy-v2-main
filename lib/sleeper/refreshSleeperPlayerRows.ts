import 'server-only'

import { prisma } from '@/lib/prisma'
import { getPlayersBySport } from '@/lib/sleeper-client'

/**
 * Keep the Sleeper-sourced `SportsPlayer` rows current, without deleting any.
 *
 * ⚠ WHY THIS EXISTS WHEN A SEED SERVICE ALREADY DOES. `SleeperPlayerSeedService`
 * writes the same rows and has **no caller anywhere in the repo** — no route, no
 * cron, no script. That is not an oversight to fix by calling it: its shape is
 * `deleteMany({ sport, source })` followed by `createMany`, so running it in
 * production would delete every Sleeper-sourced player row and rebuild it. There
 * is no safe moment to do that on a live product, which is why nobody ever has.
 *
 * ⚠ AND TWO WRITERS ALREADY DISAGREE ABOUT THE KEY. The table is unique on
 * `(sport, externalId, source)`. `SleeperPlayerSeedService` writes `externalId`
 * as the bare Sleeper id; `scripts/sync-rookies-from-sleeper.ts` — the one that
 * actually gets run — writes `sleeper:<id>`. Both use `source: 'sleeper'`. A
 * third writer picking either format would double every row it touched, and the
 * seed service's deleteMany would take the other writer's rows with it.
 *
 * So this matches on `sleeperId` FIRST and updates whatever row is already
 * there, in whatever format it was written. Only a player with no row at all
 * gets created, and then in the prefixed format, because that is the one in use.
 * Reconciling the two formats is a separate job with its own evidence; this one
 * refuses to make the split worse.
 *
 * ⚠ STALEST FIRST, AND BUDGETED. Ordered by `fetchedAt` ascending so successive
 * runs cover the whole set without a stored cursor — the pairing
 * `lib/cron/runBudget.ts` documents as mandatory, because a budget without
 * staleness ordering does the first few rows forever and never reaches the tail.
 */

const SOURCE = 'sleeper'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export type SleeperRowRefreshResult = {
  /** Rows examined this run. */
  scanned: number
  updated: number
  created: number
  /** Players on the feed we did not reach before the budget ran out. */
  remaining: number
  /** True when the feed itself could not be read — nothing was written. */
  feedUnavailable: boolean
}

type FeedPlayer = {
  player_id?: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  team?: string | null
  position?: string | null
  age?: number | string | null
  years_exp?: number | string | null
  height?: string | null
  weight?: string | null
  college?: string | null
  status?: string | null
}

/** Matches the seed service's parse: a non-finite value becomes null, never 0. */
function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function fullName(p: FeedPlayer): string {
  const joined = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
  return (p.full_name ?? joined ?? '').trim() || joined
}

/**
 * Refresh a bounded slice of the Sleeper player set.
 *
 * Never throws: this rides on a cron whose actual job is importing players, and
 * enrichment must not fail the run that populated the roster.
 */
export async function refreshSleeperPlayerRows(args: {
  sport?: 'NFL'
  /** How many players to touch this run. Keeps one unit small. */
  limit?: number
  /** Checked BETWEEN batches, never inside one. */
  isExhausted?: () => boolean
}): Promise<SleeperRowRefreshResult> {
  const sport = args.sport ?? 'NFL'
  const limit = Math.max(1, args.limit ?? 400)
  const isExhausted = args.isExhausted ?? (() => false)

  const empty: SleeperRowRefreshResult = {
    scanned: 0,
    updated: 0,
    created: 0,
    remaining: 0,
    feedUnavailable: false,
  }

  let feed: Record<string, FeedPlayer>
  try {
    feed = (await getPlayersBySport(sport.toLowerCase())) as unknown as Record<string, FeedPlayer>
  } catch {
    return { ...empty, feedUnavailable: true }
  }
  if (!feed || typeof feed !== 'object') return { ...empty, feedUnavailable: true }

  const byId = new Map<string, FeedPlayer>()
  for (const [key, p] of Object.entries(feed)) {
    const id = String(p?.player_id ?? key ?? '').trim()
    if (!id || !fullName(p)) continue
    byId.set(id, p)
  }
  if (byId.size === 0) return { ...empty, feedUnavailable: true }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS)

  /*
   * The rows we already hold, stalest first. Selected before any write so the
   * ordering is a snapshot — updating `fetchedAt` as we go would otherwise
   * reshuffle the queue underneath the loop.
   */
  const existing = await prisma.sportsPlayer
    .findMany({
      where: { sport, source: SOURCE, sleeperId: { not: null } },
      orderBy: { fetchedAt: 'asc' },
      select: { id: true, sleeperId: true },
      take: limit,
    })
    .catch(() => [])

  let updated = 0
  let created = 0
  let scanned = 0
  const touched = new Set<string>()

  for (const row of existing) {
    if (isExhausted()) break
    const id = row.sleeperId
    if (!id) continue
    const p = byId.get(id)
    scanned += 1
    /*
     * A player on file that the feed no longer lists is LEFT ALONE. Sleeper
     * drops retired and released players, and deleting our row would erase a
     * name that still appears in historical trades and rosters.
     */
    if (!p) continue
    touched.add(id)

    const ok = await prisma.sportsPlayer
      .update({
        where: { id: row.id },
        data: {
          name: fullName(p),
          position: p.position?.trim() || undefined,
          team: p.team?.trim() || undefined,
          age: toFiniteNumber(p.age),
          yearsExp: toFiniteNumber(p.years_exp),
          height: p.height?.trim() || null,
          weight: p.weight?.trim() || null,
          college: p.college?.trim() || null,
          status: p.status?.trim() || null,
          fetchedAt: now,
          expiresAt,
        },
      })
      .then(() => true)
      .catch(() => false)
    if (ok) updated += 1
  }

  /*
   * Players the feed has and we do not. Bounded by whatever slice of the limit
   * the update pass did not use, so one run never does two full passes.
   */
  const createBudget = Math.max(0, limit - scanned)
  if (createBudget > 0 && !isExhausted()) {
    const known = await prisma.sportsPlayer
      .findMany({
        where: { sport, source: SOURCE, sleeperId: { in: [...byId.keys()] } },
        select: { sleeperId: true },
      })
      .catch(() => [])
    const haveIds = new Set(known.map((k) => k.sleeperId).filter(Boolean) as string[])

    const missing = [...byId.entries()].filter(([id]) => !haveIds.has(id)).slice(0, createBudget)
    for (const [id, p] of missing) {
      if (isExhausted()) break
      const ok = await prisma.sportsPlayer
        .create({
          data: {
            sport,
            /*
             * ⚠ THE PREFIXED FORMAT, MATCHING THE WRITER THAT ACTUALLY RUNS.
             * `scripts/sync-rookies-from-sleeper.ts` writes `sleeper:<id>` and
             * is the path in use; the uncalled seed service writes the bare id.
             * Picking the other one would create a second row for every player
             * the script has already inserted.
             */
            externalId: `${SOURCE}:${id}`,
            name: fullName(p),
            position: p.position?.trim() || null,
            team: p.team?.trim() || null,
            age: toFiniteNumber(p.age),
            yearsExp: toFiniteNumber(p.years_exp),
            height: p.height?.trim() || null,
            weight: p.weight?.trim() || null,
            college: p.college?.trim() || null,
            imageUrl: `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`,
            sleeperId: id,
            status: p.status?.trim() || null,
            source: SOURCE,
            fetchedAt: now,
            expiresAt,
          },
        })
        .then(() => true)
        /* A concurrent writer winning the unique key is not an error here. */
        .catch(() => false)
      if (ok) created += 1
    }
  }

  return {
    scanned,
    updated,
    created,
    remaining: Math.max(0, byId.size - touched.size - created),
    feedUnavailable: false,
  }
}
