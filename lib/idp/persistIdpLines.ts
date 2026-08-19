import { prisma } from '@/lib/prisma'
import type { PbpGame } from '@/lib/live/rollingInsightsPlayByPlay'
import { idpLinesFromGame } from '@/lib/idp/pbpToIdp'

/**
 * Persist NFL defensive stat lines derived from play-by-play.
 *
 * Writes into `FantasyStatLine` with `source: 'rolling_insights_pbp'`, alongside
 * the CFBD college rows rather than into a table of its own — the shape is the
 * same (one player, one week, a JSON stat map) and the unique key already
 * separates sources, so NFL IDP and college offense can never collide.
 *
 * ⚠ THIS IS WHAT MAKES THE FABRICATED GENERATOR UNNECESSARY.
 * `generateDeterministicWeeklyStatLine` produces a defender's week from a hash
 * of their id. Once real rows exist for a week, nothing has to invent one.
 */

/** Matches the CFBD writer — a week's stats stay valid well past the week. */
const STAT_TTL_MS = 7 * 24 * 60 * 60 * 1000

const SOURCE = 'rolling_insights_pbp'

export type IdpPersistResult = {
  playersWritten: number
  skipped: 'no-week' | null
}

/**
 * Write one game's defensive lines.
 *
 * ⚠ SKIPPED ENTIRELY WITHOUT A SEASON AND WEEK. The unique key is
 * (player, sport, season, week, source), so writing an unknown week as 0 would
 * make every week of a player's season collapse onto one row and overwrite each
 * other. A missing line is recoverable; a silently merged season is not.
 *
 * ⚠ NEVER THROWS. This runs on the game-day path behind live scoring. A stat
 * line is worth less than a score, so a failure here returns a count of zero
 * rather than interrupting the tick.
 */
export async function persistIdpForGame(
  game: PbpGame,
  meta: { season: number | null; week: number | null },
  now: Date = new Date(),
): Promise<IdpPersistResult> {
  if (meta.season == null || meta.week == null) return { playersWritten: 0, skipped: 'no-week' }

  const lines = idpLinesFromGame(game)
  if (lines.length === 0) return { playersWritten: 0, skipped: null }

  const expiresAt = new Date(now.getTime() + STAT_TTL_MS)
  let written = 0

  for (const line of lines) {
    /*
     * The stat map is stored raw and unscored. `fantasyPointsByScoringPreset`
     * stays empty on purpose: IDP settings vary far more than offensive ones,
     * so a number computed here would be one league's answer presented as
     * everyone's. The scoring engine already reads the canonical `idp_*` keys.
     */
    const data = {
      team: line.teamAbbr,
      opponent: null,
      stats: {
        playerName: line.playerName,
        position: line.position,
        gameId: game.gameId,
        ...line.stats,
      } as never,
      fantasyPointsByScoringPreset: {} as never,
      source: SOURCE,
      fetchedAt: now,
      expiresAt,
    }

    try {
      await prisma.fantasyStatLine.upsert({
        where: {
          uniq_fantasy_stat_line_player_week_source: {
            playerId: line.playerId,
            sport: 'NFL',
            season: String(meta.season),
            week: meta.week,
            source: SOURCE,
          },
        },
        // Cumulative: each poll re-reads the whole plays array, so the newest
        // derivation is always the complete one. Replacing beats accumulating.
        update: data,
        create: {
          playerId: line.playerId,
          sport: 'NFL',
          season: String(meta.season),
          week: meta.week,
          ...data,
        },
      })
      written += 1
    } catch {
      // One bad row must not cost the rest of the defense.
    }
  }

  return { playersWritten: written, skipped: null }
}

/**
 * Season and week for a Rolling Insights game id.
 *
 * Read from `SportsGame` rather than derived from the date: a game id encodes
 * a date, and a date is not a week — Thursday and the following Monday are the
 * same NFL week, and the season rolls over mid-calendar-year.
 */
export async function gameWeekMeta(
  riGameId: string,
): Promise<{ season: number | null; week: number | null }> {
  const row = await prisma.sportsGame
    .findFirst({
      where: { sport: 'NFL', externalId: riGameId, source: 'rolling_insights' },
      select: { season: true, week: true },
    })
    .catch(() => null)
  return { season: row?.season ?? null, week: row?.week ?? null }
}
