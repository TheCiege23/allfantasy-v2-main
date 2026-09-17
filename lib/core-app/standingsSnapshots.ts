import 'server-only'

import { prisma } from '@/lib/prisma'
import { isWeekSnapshot, type WeekSnapshot } from './standingsModel'

/**
 * Weekly standings snapshots — item 9 of the 2026-09-17 standings brief.
 *
 * The board is cumulative: week 9's table needs weeks 1–8 folded in, and movement, the history chart and
 * the all-play numbers need every week's table. Rebuilding that from `WeeklyMatchup` on every visit reads
 * every row the league has. A finished week never changes (bar a stat correction), so each one is folded
 * ONCE and stored here; a visit then reads the stored weeks by key and folds only what is newer.
 *
 * ⚠ A STORED WEEK IS TRUSTED ONLY WHILE ITS STAMP MATCHES. The stamp is a chain over every week's row
 * count, scored count and point sums up to that week (`chainStamps`), read with one grouped query. A stat
 * correction anywhere at or before week N changes the chain from there on, the stored weeks stop matching,
 * and they are rebuilt from rows and rewritten — so this can make a visit cheaper but never wrong.
 *
 * ⚠ READ-THROUGH, SO THERE IS NO SCHEDULED WRITER TO FORGET. The first visit after a week settles writes
 * it. A league nobody opens has no snapshots, and costs nothing.
 *
 * Stored in `SportsDataCache` (one row per league per season per week — ~250 leagues × 17 weeks a
 * season), keyed on the PROVIDER's league id because that is what `WeeklyMatchup` — the only input — is
 * keyed on. Kept 400 days so last season's history survives the off-season.
 *
 * Kill switch: `CORE_STANDINGS_SNAPSHOTS_DISABLED=1` stops both reads and writes; the board is then
 * rebuilt from rows every time, exactly as it was before this existed.
 */

const TTL_MS = 400 * 24 * 60 * 60 * 1000

export function standingsSnapshotsDisabled(): boolean {
  return process.env.CORE_STANDINGS_SNAPSHOTS_DISABLED === '1'
}

export function standingsSnapshotKey(platformLeagueId: string, season: number, week: number): string {
  return `core-standings:week:v1:${platformLeagueId}:${season}:${week}`
}

/** Stored snapshots for these weeks, keyed by week. A missing, expired or malformed row is simply absent. */
export async function readStandingsSnapshots(
  platformLeagueId: string,
  season: number,
  weeks: number[],
  now: Date = new Date(),
): Promise<Map<number, WeekSnapshot>> {
  const out = new Map<number, WeekSnapshot>()
  if (standingsSnapshotsDisabled() || weeks.length === 0) return out
  const keyToWeek = new Map(weeks.map((w) => [standingsSnapshotKey(platformLeagueId, season, w), w]))
  const rows = await prisma.sportsDataCache
    .findMany({
      where: { cacheKey: { in: [...keyToWeek.keys()] } },
      select: { cacheKey: true, data: true, expiresAt: true },
    })
    .catch(() => [])
  for (const row of rows) {
    const week = keyToWeek.get(row.cacheKey)
    if (week == null || row.expiresAt.getTime() <= now.getTime()) continue
    if (isWeekSnapshot(row.data, season, week)) out.set(week, row.data)
  }
  return out
}

/**
 * Store settled weeks. Never throws: a failed write costs the next visit a rebuild, and a board that
 * rendered correctly must not fail because its cache did not save.
 */
export async function writeStandingsSnapshots(
  platformLeagueId: string,
  snapshots: WeekSnapshot[],
  now: Date = new Date(),
): Promise<number> {
  if (standingsSnapshotsDisabled() || snapshots.length === 0) return 0
  const expiresAt = new Date(now.getTime() + TTL_MS)
  const results = await Promise.allSettled(
    snapshots.map((snap) => {
      const cacheKey = standingsSnapshotKey(platformLeagueId, snap.season, snap.week)
      const data = JSON.parse(JSON.stringify(snap)) as object
      return prisma.sportsDataCache.upsert({
        where: { cacheKey },
        create: { cacheKey, data, expiresAt },
        update: { data, expiresAt },
      })
    }),
  )
  return results.filter((r) => r.status === 'fulfilled').length
}
