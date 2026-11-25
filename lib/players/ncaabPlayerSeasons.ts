import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { NCAAB_APPEARANCE_STATS } from '@/lib/sport-teams/ncaabSeasonBoxes'

/**
 * A college basketball player's seasons and game log for his player card, from our own stored box
 * scores. DB-first: one read of `player_game_stats`, summed here.
 *
 * 🛑 THE CARD SAID "Game logs for NCAAB coming soon" WHILE EVERY GAME WAS IN THE TABLE. The card's
 * season history reads `player_season_stats`, which holds no NCAAB rows, and its game log is wired to
 * the NFL endpoint only (production, 2026-11-25).
 *
 * A SEASON IS EVERY GAME BUT THE PRESEASON — the owner's decision recorded in
 * `lib/chimmy/tools/collegeBasketballStats.ts`: conference tournaments and the NCAA Tournament count,
 * as college season statistics are kept, and the summary says how many postseason games it includes.
 * Only finished games he appeared in are counted. "Appeared" is any recorded stat, not minutes alone:
 * the vendor leaves minutes at 0 for whole games (`NCAAB_APPEARANCE_STATS`), and the draft board's
 * season line counts the same way, so the two never disagree.
 *
 * Joined by Rolling Insights id — never by name. The vendor's box can omit a player (GAPS N-15), so
 * a total can run slightly low; nothing here fills a gap.
 */

const SPORT = 'NCAAB'
const SOURCE = 'rolling_insights_live'

export type NcaabGameLine = {
  /** The season's starting year: 2026 is 2026–27. */
  season: number
  /** YYYY-MM-DD, or null when the row carries no date. */
  date: string | null
  team: string | null
  opponent: string | null
  postseason: boolean
  /** 0 when the vendor recorded none for this game. */
  minutes: number
  points: number
  rebounds: number
  assists: number
  steals: number
  blocks: number
  turnovers: number
  threesMade: number
  threesAttempted: number
  fieldGoalsMade: number
  fieldGoalsAttempted: number
  freeThrowsMade: number
  freeThrowsAttempted: number
}

export type NcaabSeasonSummary = {
  season: number
  /** "2026–27". */
  label: string
  games: number
  postseasonGames: number
  /** The team of his most recent game that season. */
  team: string | null
  perGame: {
    /** Averaged over the games that recorded minutes; null when none did. */
    minutes: number | null
    points: number
    rebounds: number
    assists: number
    steals: number
    blocks: number
    turnovers: number
    threesMade: number
  }
  /** 0–1, or null with no attempts. */
  fieldGoalPct: number | null
  threePointPct: number | null
  freeThrowPct: number | null
}

export type NcaabPlayerSeasons = {
  /** Newest first. */
  seasons: NcaabSeasonSummary[]
  /** Newest first, across every season returned. */
  games: NcaabGameLine[]
}

export type NcaabGameRow = {
  season: number
  gameDate: Date | string | null
  team: string | null
  opponent: string | null
  seasonType: string | null
  gameFinal: string | null
  box: unknown
}

function seasonLabel(season: number): string {
  return `${season}–${String((season + 1) % 100).padStart(2, '0')}`
}

function dayOf(value: Date | string | null): string | null {
  if (value == null) return null
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : String(value)
  const day = text.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

const stat = (box: Record<string, unknown>, key: string): number => {
  const value = box[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const round1 = (value: number): number => Math.round(value * 10) / 10
const pct = (made: number, attempted: number): number | null => (attempted > 0 && made <= attempted ? made / attempted : null)

/**
 * Stored rows → the card's game log and season summaries. Pure, so the counting rules are testable
 * without a database: a game counts when it is not preseason, is finished (an earlier day, or marked
 * final today) and the player appeared in it.
 */
export function summarizeNcaabGames(rows: readonly NcaabGameRow[], now: Date = new Date()): NcaabPlayerSeasons {
  const today = now.toISOString().slice(0, 10)
  const games: NcaabGameLine[] = []
  for (const row of rows) {
    if (!Number.isInteger(row.season)) continue
    const type = String(row.seasonType ?? '').trim().toLowerCase()
    if (type === 'pre') continue
    const date = dayOf(row.gameDate)
    const finished = (date != null && date < today) || String(row.gameFinal ?? '') === 'true'
    if (!finished) continue
    if (!row.box || typeof row.box !== 'object' || Array.isArray(row.box)) continue
    const box = row.box as Record<string, unknown>
    if (!NCAAB_APPEARANCE_STATS.some((key) => stat(box, key) > 0)) continue
    const minutes = stat(box, 'minutes')
    games.push({
      season: row.season,
      date,
      team: row.team ? String(row.team) : null,
      opponent: row.opponent ? String(row.opponent) : null,
      postseason: type === 'post',
      minutes,
      points: stat(box, 'points'),
      rebounds: stat(box, 'total_rebounds'),
      assists: stat(box, 'assists'),
      steals: stat(box, 'steals'),
      blocks: stat(box, 'blocks'),
      turnovers: stat(box, 'turnovers'),
      threesMade: stat(box, 'three_points_made'),
      threesAttempted: stat(box, 'three_points_attempted'),
      fieldGoalsMade: stat(box, 'field_goals_made'),
      fieldGoalsAttempted: stat(box, 'field_goals_attempted'),
      freeThrowsMade: stat(box, 'free_throws_made'),
      freeThrowsAttempted: stat(box, 'free_throws_attempted'),
    })
  }
  // Newest first; an undated game sorts last within its season.
  games.sort((a, b) => b.season - a.season || String(b.date ?? '').localeCompare(String(a.date ?? '')))

  const bySeason = new Map<number, NcaabGameLine[]>()
  for (const game of games) bySeason.set(game.season, [...(bySeason.get(game.season) ?? []), game])
  const seasons: NcaabSeasonSummary[] = [...bySeason.entries()]
    .sort(([a], [b]) => b - a)
    .map(([season, list]) => {
      const n = list.length
      const sum = (key: keyof NcaabGameLine) => list.reduce((total, g) => total + (g[key] as number), 0)
      const timed = list.filter((g) => g.minutes > 0).length
      return {
        season,
        label: seasonLabel(season),
        games: n,
        postseasonGames: list.filter((g) => g.postseason).length,
        team: list[0]?.team ?? null,
        perGame: {
          minutes: timed > 0 ? round1(sum('minutes') / timed) : null,
          points: round1(sum('points') / n),
          rebounds: round1(sum('rebounds') / n),
          assists: round1(sum('assists') / n),
          steals: round1(sum('steals') / n),
          blocks: round1(sum('blocks') / n),
          turnovers: round1(sum('turnovers') / n),
          threesMade: round1(sum('threesMade') / n),
        },
        fieldGoalPct: pct(sum('fieldGoalsMade'), sum('fieldGoalsAttempted')),
        threePointPct: pct(sum('threesMade'), sum('threesAttempted')),
        freeThrowPct: pct(sum('freeThrowsMade'), sum('freeThrowsAttempted')),
      }
    })
  return { seasons, games }
}

/** A Rolling Insights player id is digits only; anything else is not looked up. */
export function isRollingInsightsPlayerId(value: string | null | undefined): value is string {
  return /^\d{1,12}$/.test(String(value ?? '').trim())
}

/**
 * Every stored game for one Rolling Insights player id. The identity sub-select keeps the read on
 * the `(playerId, sportType, season)` index; `provider_player_id` alone has none.
 */
export async function loadNcaabPlayerSeasons(rollingInsightsId: string, now: Date = new Date()): Promise<NcaabPlayerSeasons> {
  const id = String(rollingInsightsId ?? '').trim()
  if (!isRollingInsightsPlayerId(id)) return { seasons: [], games: [] }
  const rows = await prisma.$queryRaw<NcaabGameRow[]>(Prisma.sql`
    SELECT g.season::int AS season, g.game_date AS "gameDate", g.team, g.opponent,
           g.normalized_stat_map ->> 'seasonType' AS "seasonType",
           g.normalized_stat_map ->> 'gameFinal' AS "gameFinal",
           g.normalized_stat_map -> 'stats' AS box
    FROM player_game_stats g
    WHERE g."sportType" = ${SPORT} AND g.source = ${SOURCE} AND g.provider_player_id = ${id}
      AND g."playerId" IN (SELECT m.id FROM "PlayerIdentityMap" m WHERE m.sport = ${SPORT} AND m."rollingInsightsId" = ${id})
    ORDER BY g.game_date DESC NULLS LAST`)
  return summarizeNcaabGames(rows, now)
}
