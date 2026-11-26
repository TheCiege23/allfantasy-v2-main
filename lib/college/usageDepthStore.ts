import { prisma } from '@/lib/prisma'
import { createTtlMemo } from '@/lib/ttl-memo'
import {
  USAGE_DEPTH_GAMES,
  USAGE_DEPTH_SOURCE,
  USAGE_STATS,
  rankSchoolUsage,
  type SchoolUsage,
  type UsageGameRow,
  type UsageRank,
  type UsageStat,
} from '@/lib/college/usageDepth'

/**
 * Stores and reads the college football usage depth (rules: ./usageDepth.ts) in `depth_charts`, one row
 * per (school, stat) with `source = 'af_usage'`, beside the vendor depth charts the table already holds.
 *
 * WRITER: the weekly `/api/cron/import-depth-charts`, for NCAAF, which Rolling Insights has no feed for.
 * It reads CFBD's weekly box scores already in `player_game_stats` (`source = 'cfbd-weekly'`; school and
 * name live in `stat_payload._team` / `.name`). DB-first: no provider is called.
 * READER: the draft pool, for a college player's card.
 */

const KEEP = 12
const TTL_MS = 21 * 24 * 60 * 60 * 1000

/** The CFB season the newest box scores belong to. */
async function newestSeason(): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ season: number | null }>>`
    SELECT max(season)::int AS season FROM player_game_stats WHERE "sportType" = 'NCAAF' AND source = 'cfbd-weekly'`
  return rows[0]?.season ?? null
}

export async function writeNcaafUsageDepth(): Promise<{ season: number | null; schools: number; rows: number }> {
  const season = await newestSeason()
  if (season == null) return { season, schools: 0, rows: 0 }
  // One row per player per game, stats summed (a player can carry several stat-category rows).
  // ⚠ CFBD rows keep their stats at the TOP of normalized_stat_map ("rushing.CAR"), not under `stats`;
  // reading only `->'stats'` returned zero for every row (checked 2026-11-26). Both are read.
  const raw = await prisma.$queryRaw<Array<{ school: string; name: string; game_date: string; att: number; car: number; rec: number }>>`
    SELECT stat_payload->>'_team' AS school,
           stat_payload->>'name' AS name,
           to_char(game_date, 'YYYY-MM-DD') AS game_date,
           sum(coalesce((normalized_stat_map->>'passing.ATT')::numeric, (normalized_stat_map->'stats'->>'passing.ATT')::numeric, 0))::float AS att,
           sum(coalesce((normalized_stat_map->>'rushing.CAR')::numeric, (normalized_stat_map->'stats'->>'rushing.CAR')::numeric, 0))::float AS car,
           sum(coalesce((normalized_stat_map->>'receiving.REC')::numeric, (normalized_stat_map->'stats'->>'receiving.REC')::numeric, 0))::float AS rec
    FROM player_game_stats
    WHERE "sportType" = 'NCAAF' AND source = 'cfbd-weekly' AND season = ${season}
      AND game_date IS NOT NULL AND stat_payload->>'_team' IS NOT NULL AND stat_payload->>'name' IS NOT NULL
    GROUP BY 1, 2, 3`
  const rows: UsageGameRow[] = raw.map((r) => ({ school: r.school, name: r.name, gameDate: r.game_date, att: r.att, car: r.car, rec: r.rec }))
  const usage = rankSchoolUsage(rows, USAGE_DEPTH_GAMES)
  const expiresAt = new Date(Date.now() + TTL_MS)
  let written = 0
  for (const [school, u] of usage) {
    for (const stat of USAGE_STATS) {
      const players = { games: u.games, ranks: u.byStat[stat].slice(0, KEEP) }
      await prisma.depthChart.upsert({
        where: { sport_team_position_source: { sport: 'NCAAF', team: school, position: stat, source: USAGE_DEPTH_SOURCE } },
        create: { sport: 'NCAAF', team: school, position: stat, source: USAGE_DEPTH_SOURCE, season: String(season), players, expiresAt },
        update: { season: String(season), players, expiresAt, fetchedAt: new Date() },
      })
      written += 1
    }
  }
  return { season, schools: usage.size, rows: written }
}

export type UsageDepthIndex = {
  /** By CFBD school name, lowercased ("ohio state"). */
  bySchool: Map<string, SchoolUsage>
  /** Rolling Insights full school name ("ohio state university") → CFBD school name. */
  riToCfbd: Map<string, string>
}

const memo = createTtlMemo<UsageDepthIndex>({ ttlMs: 60 * 60 * 1000, maxEntries: 2 })

export function indexUsageDepthRows(rows: Array<{ team: string; position: string; players: unknown }>): Map<string, SchoolUsage> {
  const bySchool = new Map<string, SchoolUsage>()
  for (const row of rows) {
    const stat = row.position as UsageStat
    if (!(USAGE_STATS as readonly string[]).includes(stat)) continue
    const p = row.players as { games?: unknown; ranks?: unknown } | null
    if (!p || !Array.isArray(p.ranks)) continue
    const key = row.team.trim().toLowerCase()
    const cur = bySchool.get(key) ?? { games: Number(p.games) || 0, byStat: { att: [], car: [], rec: [] } }
    cur.byStat[stat] = p.ranks as UsageRank[]
    cur.games = Math.max(cur.games, Number(p.games) || 0)
    bySchool.set(key, cur)
  }
  return bySchool
}

/** RI full name → CFBD name: by shared team code first, then "University of X" / "X University". */
export function bridgeRiToCfbd(
  ri: Array<{ name: string | null; shortName: string | null }>,
  cfbd: Array<{ name: string | null; shortName: string | null }>,
): Map<string, string> {
  const cfbdByCode = new Map<string, string>()
  const cfbdByName = new Map<string, string>()
  for (const c of cfbd) {
    if (!c.name) continue
    if (c.shortName) cfbdByCode.set(c.shortName.trim().toUpperCase(), c.name.trim())
    cfbdByName.set(c.name.trim().toLowerCase(), c.name.trim())
  }
  const out = new Map<string, string>()
  for (const r of ri) {
    if (!r.name) continue
    const full = r.name.trim()
    const byCode = r.shortName ? cfbdByCode.get(r.shortName.trim().toUpperCase()) : undefined
    const stripped = full.replace(/^University of /i, '').replace(/^The /i, '').replace(/ University$/i, '')
    const byName = cfbdByName.get(stripped.toLowerCase()) ?? cfbdByName.get(full.toLowerCase())
    const hit = byCode ?? byName
    if (hit) out.set(full.toLowerCase(), hit)
  }
  return out
}

export async function loadUsageDepthIndex(): Promise<UsageDepthIndex> {
  const hit = memo.get('NCAAF')
  if (hit) return hit
  const [rows, ri, cfbd] = await Promise.all([
    prisma.depthChart.findMany({ where: { sport: 'NCAAF', source: USAGE_DEPTH_SOURCE }, select: { team: true, position: true, players: true } }),
    prisma.sportsTeam.findMany({ where: { sport: 'NCAAF', source: 'rolling_insights' }, select: { name: true, shortName: true } }),
    prisma.sportsTeam.findMany({ where: { sport: 'NCAAF', source: 'cfbd' }, select: { name: true, shortName: true } }),
  ])
  const index = { bySchool: indexUsageDepthRows(rows), riToCfbd: bridgeRiToCfbd(ri, cfbd) }
  if (index.bySchool.size > 0) memo.set('NCAAF', index)
  return index
}

/** The usage for a school named either way (CFBD "Ohio State" or Rolling Insights "Ohio State University"). */
export function usageForSchool(index: UsageDepthIndex, school: string | null | undefined): { usage: SchoolUsage; label: string } | null {
  const s = school?.trim()
  if (!s) return null
  const direct = index.bySchool.get(s.toLowerCase())
  if (direct) return { usage: direct, label: s }
  const cfbd = index.riToCfbd.get(s.toLowerCase())
  const viaBridge = cfbd ? index.bySchool.get(cfbd.toLowerCase()) : undefined
  return viaBridge ? { usage: viaBridge, label: cfbd! } : null
}
