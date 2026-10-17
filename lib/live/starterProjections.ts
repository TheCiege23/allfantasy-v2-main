import 'server-only'
import { prisma } from '@/lib/prisma'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { namesBySleeperId, readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { priceStarterProjections, type ProjectionRow, type StarterProjection } from '@/lib/live/starterProjectionPricing'

/**
 * Projections for your starters in NFL games that have not kicked off, so the live slate shows
 * "proj 14.2" instead of a row of 0.0s (2026-10-11 audit).
 *
 * ⚠ THE SAME SOURCE AND THE SAME RULES AS `/core/matchup` (`loadSideProjections`): the provider's
 * component stat line from `fantasy_projections`, rescored under each league's own scoring, a ruled-out
 * starter priced at 0, and NO generic-PPR fallback for a league whose rules we do not have. Two
 * screens pricing one starter two ways is the drift that file's header warns about.
 *
 * ⚠ CACHED, BECAUSE THIS PAGE POLLS. `/api/dashboard/live-scores` is re-read every 20 seconds per
 * viewer while a game is live, and a projection does not change between polls — the cron rewrites it
 * a few times a day. The two reads below are held per process for `CACHE_MS`, keyed on exactly what
 * was asked for, and the caller skips them entirely when none of your starters has a game still to
 * start.
 */

const CACHE_MS = 5 * 60_000
const CACHE_MAX = 200

type Reads = { rows: ProjectionRow[]; outIds: Set<string> }
const cache = new Map<string, { at: number; value: Promise<Reads> }>()

/** NFL only: the weekly `fantasy_projections` feed is keyed by NFL week, and no other sport has one. */
export const PROJECTED_SPORTS: ReadonlySet<string> = new Set(['NFL'])

async function readOnce(
  periods: ReadonlyArray<{ season: number; week: number }>,
  playerIds: readonly string[],
  identities: ReadonlyArray<{ sleeperId: string | null; name: string; team: string | null; position: string | null }>,
): Promise<Reads> {
  const ids = [...new Set(playerIds)].sort()
  const seasons = [...new Set(periods.map((p) => String(p.season)))].sort()
  const weeks = [...new Set(periods.map((p) => p.week))].sort((a, b) => a - b)
  const key = `${seasons.join(',')}|${weeks.join(',')}|${ids.join(',')}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.value

  const value = (async (): Promise<Reads> => {
    const [rows, statuses] = await Promise.all([
      prisma.fantasyProjection.findMany({
        // AF mirror rows (source 'allfantasy') carry no component stat line to rescore — same filter
        // as `loadSideProjections`.
        where: { sport: 'NFL', playerId: { in: ids }, season: { in: seasons }, week: { in: weeks }, source: { not: 'allfantasy' } },
        select: { playerId: true, season: true, week: true, stats: true, fetchedAt: true },
      }),
      readInjuryStatusById(
        'NFL',
        namesBySleeperId(identities.filter((p) => p.sleeperId != null && ids.includes(p.sleeperId))),
        new Map(identities.map((p) => [p.sleeperId ?? '', p.team])),
        new Map(identities.map((p) => [p.sleeperId ?? '', p.position])),
      ).catch(() => new Map<string, string>()),
    ])
    const outIds = new Set([...statuses].filter(([, status]) => isRuledOut(status)).map(([id]) => id))
    return {
      rows: rows.map((r) => ({
        playerId: r.playerId,
        season: Number(r.season),
        week: r.week,
        stats: r.stats,
        fetchedAt: r.fetchedAt,
      })),
      outIds,
    }
  })()

  cache.set(key, { at: now, value })
  // A failed read must not be served from the cache for five minutes.
  value.catch(() => cache.delete(key))
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return value
}

/**
 * Projected points per (league, starter), keyed `${leagueKey}:${playerId}`.
 *
 * `leagues[].playerIds` must already be narrowed to starters whose game has not started — the caller
 * knows the slate, this module does not. An empty input reads nothing.
 */
export async function loadStarterProjections(input: {
  leagues: ReadonlyArray<{ key: string; season: number; week: number; settings: unknown; playerIds: readonly string[] }>
  identities: ReadonlyArray<{ sleeperId: string | null; name: string; team: string | null; position: string | null }>
}): Promise<Map<string, StarterProjection>> {
  const leagues = input.leagues.filter((l) => l.playerIds.length > 0)
  if (leagues.length === 0) return new Map()
  const reads = await readOnce(
    leagues.map((l) => ({ season: l.season, week: l.week })),
    leagues.flatMap((l) => l.playerIds),
    input.identities,
  )
  return priceStarterProjections(leagues, reads.rows, reads.outIds)
}

export type { StarterProjection }
