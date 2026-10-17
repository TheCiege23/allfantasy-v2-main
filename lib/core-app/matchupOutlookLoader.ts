import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { buildMatchupOutlook, MATCHUP_POSITIONS, type DefenseCell, type MatchupOutlook } from './matchupOutlook'
import { normalizePosition } from './positionNormalization'

/**
 * Loader for the finder's matchup ranks (matchupOutlook.ts has the rules).
 *
 * DB-first: `player_game_stats` — the same rows the projection writer's defense-vs-position factor
 * reads (writeAfProjectionSnapshots) — in PPR (`pts_ppr`), with positions from `PlayerIdentityMap`
 * by Sleeper id. One aggregate per season for every defense and position at once, cached 30 minutes
 * and shared by every player's card; a failed read is not cached.
 *
 * ⚠ CLUB CODES ARE FOLDED BEFORE GROUPING. The stats table spells JAX / LAR / WAS; other feeds spell
 * JAC / LA / WSH. Both sides go through `normalizeTeamAbbrev`, and a defense spelled two ways is ONE
 * defense — its weeks are merged, not ranked twice.
 */

const TTL_MS = 30 * 60_000
const cache = new Map<number, { at: number; cells: Promise<DefenseCell[]> }>()

type Row = { opponent: string; pos: string; week: number; allowed: number }

function defenseCells(season: number): Promise<DefenseCell[]> {
  const hit = cache.get(season)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cells
  const cells = prisma
    .$queryRaw<Row[]>(Prisma.sql`
      SELECT s.opponent, pim.position AS pos, s."weekOrRound" AS week,
             sum((s.normalized_stat_map->>'pts_ppr')::float8)::float8 AS allowed
      FROM player_game_stats s
      JOIN "PlayerIdentityMap" pim ON pim.sport = 'NFL' AND pim."sleeperId" = s."playerId"
      WHERE s."sportType" = 'NFL' AND s.season = ${season}
        AND s.opponent IS NOT NULL
        AND jsonb_typeof(s.normalized_stat_map->'pts_ppr') = 'number'
        AND pim.position IN (${Prisma.join([...MATCHUP_POSITIONS])})
      GROUP BY 1, 2, 3
    `)
    .then((rows) => {
      // defense|pos -> week -> points, after folding the club code.
      const byCell = new Map<string, Map<number, number>>()
      for (const r of rows) {
        const defense = normalizeTeamAbbrev(r.opponent)
        const pos = normalizePosition(r.pos)
        const pts = Number(r.allowed)
        if (!defense || !pos || !Number.isFinite(pts)) continue
        const key = `${defense}|${pos}`
        const weeks = byCell.get(key) ?? new Map<number, number>()
        weeks.set(Number(r.week), (weeks.get(Number(r.week)) ?? 0) + pts)
        byCell.set(key, weeks)
      }
      return [...byCell].map(([key, weeks]) => {
        const [defense, position] = key.split('|')
        const total = [...weeks.values()].reduce((s, v) => s + v, 0)
        return { defense, position, games: weeks.size, allowedPerGame: total / weeks.size }
      })
    })
    .catch(() => {
      cache.delete(season)
      return [] as DefenseCell[]
    })
  cache.set(season, { at: Date.now(), cells })
  return cells
}

/** Tests only. */
export function clearMatchupOutlookCache(): void {
  cache.clear()
}

export async function loadMatchupOutlook(args: {
  sport: string
  position: string | null
  season: number | null
  weeks: ReadonlyArray<{ week: number; opponent: string | null; bye: boolean }>
}): Promise<MatchupOutlook | null> {
  const position = normalizePosition(args.position)
  if (args.sport !== 'NFL' || !args.season || !(MATCHUP_POSITIONS as readonly string[]).includes(position) || args.weeks.length === 0) return null
  const cells = await defenseCells(args.season)
  return buildMatchupOutlook({ position, season: args.season, weeks: args.weeks, cells, fold: (c) => normalizeTeamAbbrev(c) })
}
