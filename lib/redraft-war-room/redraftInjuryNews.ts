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
import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { prisma } from '@/lib/prisma'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { currentDesignationFromFact } from '@/lib/core-app/injuryStatus'

function normName(name: string): string {
  return String(name ?? '').trim().toLowerCase()
}

const IGNORE_NAMES = new Set(['', 'unknown player', 'general update', 'team update'])

export interface RedraftInjuryEntry {
  status: string
  gameStatus: string | null
  reportDate: Date
  /** The port's verdict that this claim is past the sport's horizon (`InjuryFact.stale`). */
  stale: boolean
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
  /*
   * 🛑 A NAME TWO ATHLETES SHARE IS DROPPED, NOT "FIRST HIT WINS". The port returns one fact per
   * (name, team), so the Vikings WR and the Browns LB named Justin Jefferson arrive as two facts;
   * keying them by name alone handed the war room whichever came first (2026-10-11). This map's
   * readers only have a name, so a shared one is answered with nothing rather than the wrong man.
   */
  const teamByKey = new Map<string, string>()
  const shared = new Set<string>()
  let injuriesAsOf: Date | null = null
  for (const f of factList?.facts ?? []) {
    const key = normName(f.playerName)
    if (IGNORE_NAMES.has(key)) continue
    if (typeof f.status !== 'string' || !f.status.trim()) continue
    const team = foldInjuryTeam(f.team, sport) ?? ''
    const seenTeam = teamByKey.get(key)
    if (seenTeam !== undefined && seenTeam !== team) shared.add(key)
    if (!injuryByName.has(key)) {
      teamByKey.set(key, team)
      injuryByName.set(key, { status: f.status, gameStatus: null, reportDate: f.fetchedAt, stale: f.stale === true })
    }
    if (!injuriesAsOf || f.fetchedAt > injuriesAsOf) injuriesAsOf = f.fetchedAt
  }
  for (const key of shared) injuryByName.delete(key)

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

/**
 * The player's CURRENT designation from the live feed, or null — the one value a war room may show
 * or price as his injury status.
 *
 * 🛑 NEVER THE STORED ROSTER SNAPSHOT (2026-10-11). `RedraftRosterPlayer.injuryStatus` is written at
 * import/refresh time and stale by construction; the redraft and keeper war rooms let it WIN
 * (`p.injuryStatus ?? injuryByName…`), so last week's "Out" zeroed a cleared starter's projection.
 * The feed's word goes through `currentDesignationFromFact`: a stale game-day word is suppressed, a
 * season-scale ruling holds, and a healthy word ("Active") is no designation at all.
 */
export function currentInjuryDesignation(injuryByName: ReadonlyMap<string, RedraftInjuryEntry>, playerName: string): string | null {
  return currentDesignationFromFact(injuryByName.get(injuryNameKey(playerName)) ?? null)
}

/** Normalized-name key for joining a player to injury data. */
export function injuryNameKey(playerName: string): string {
  return normName(playerName)
}
