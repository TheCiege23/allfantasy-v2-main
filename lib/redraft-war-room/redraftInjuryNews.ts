/**
 * REDRAFT INJURY / NEWS LOOKUP — real, sport-isolated, deterministic.
 *
 * Injury data comes from the canonical injury read port (`lib/injuries/injuryReadPort`,
 * backed by `SportsInjury`, fed by the 15-minute import-injuries cron); news lives in
 * `PlayerNewsRecord` (player_news), populated by the import-news cron sync. Joins are
 * by normalized player name because provider rows frequently carry an empty playerId.
 *
 * No fabrication: when a player has no matching report, their injury status stays
 * whatever the roster row already had (often null). Names like "Unknown Player" /
 * "General Update" are ignored.
 */
import { prisma } from '@/lib/prisma'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'

function normName(name: string): string {
  return String(name ?? '').trim().toLowerCase()
}

const IGNORE_NAMES = new Set(['', 'unknown player', 'general update', 'team update'])

export interface RedraftInjuryEntry {
  status: string
  gameStatus: string | null
  reportDate: Date
}

export interface RedraftInjuryNews {
  /** normalized player name → latest injury entry (real status only). */
  injuryByName: Map<string, RedraftInjuryEntry>
  injuriesAsOf: Date | null
  injuryRowCount: number
  newsCount: number
  newsAsOf: Date | null
}

function sportVariants(sport: string): string[] {
  const s = String(sport ?? '').trim()
  return [s, s.toUpperCase(), s.toLowerCase()]
}

/**
 * Load the latest injury report per player + news availability for the sport.
 * Bounded queries (most recent rows) so this stays cheap on the request path.
 */
export async function fetchRedraftInjuryNews(sport: string): Promise<RedraftInjuryNews> {
  const sports = sportVariants(sport)

  // Canonical injury read port — TTL-respected, one row per player, freshest
  // source wins. Replaces the InjuryReportRecord read (measured 103.8 days
  // stale in prod on 2026-08-10). The port already collapses per player, so
  // first-hit-wins below only guards against normName-level collisions.
  const factList = await listInjuryFacts({ sport, limit: 1000 }).catch(() => null)

  const injuryByName = new Map<string, RedraftInjuryEntry>()
  let injuriesAsOf: Date | null = null
  for (const f of factList?.facts ?? []) {
    const key = normName(f.playerName)
    if (IGNORE_NAMES.has(key)) continue
    if (typeof f.status !== 'string' || !f.status.trim()) continue
    if (!injuryByName.has(key)) {
      injuryByName.set(key, { status: f.status, gameStatus: null, reportDate: f.fetchedAt })
    }
    if (!injuriesAsOf || f.fetchedAt > injuriesAsOf) injuriesAsOf = f.fetchedAt
  }

  const latestNews = await prisma.playerNewsRecord
    .findFirst({
      where: { sport: { in: sports } },
      select: { publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    })
    .catch(() => null)
  const newsCount = await prisma.playerNewsRecord.count({ where: { sport: { in: sports } } }).catch(() => 0)

  return {
    injuryByName,
    injuriesAsOf,
    injuryRowCount: injuryByName.size,
    newsCount,
    newsAsOf: latestNews?.publishedAt ?? null,
  }
}

/** Normalized-name key for joining a player to injury data. */
export function injuryNameKey(playerName: string): string {
  return normName(playerName)
}
