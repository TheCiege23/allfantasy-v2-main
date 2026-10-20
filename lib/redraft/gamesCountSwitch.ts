import { prisma } from '@/lib/prisma'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { normalizeRedraftSeasonStatus, REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import {
  GAMES_COUNT_BEST_N_KEY,
  GAMES_COUNT_MODE_KEY,
  readGamesCountSetting,
  type GamesCountSetting,
} from './gamesCount'
import { gamesCountTablesExist } from './gamesCountStore'

/**
 * When the commissioner may CHANGE "which games count" (lib/redraft/gamesCount.ts). The settings PATCH
 * asks this before its first write; `gamesCountSportConfigError` has already settled that the value is
 * valid.
 *
 * 🛑 NOT WHILE A SEASON IS UNDER WAY. A week scored under one rule and sealed under another is a
 * different score from the one both managers watched, and best-N picks or a lock-in made under one mode
 * mean nothing under the next. So a change (of the mode, or of N) is open only while no season is
 * running: before the draft (`setup`), after it but before week 1 starts, and once a season is
 * `complete`. A running season whose week dates are unknown is refused — it cannot be shown that week 1
 * has not started. Same shape as the daily/weekly lineup switch (PR #2579), written independently.
 *
 * ⚠ A NON-DEFAULT MODE ALSO NEEDS ITS TABLES. `player_week_game_scores` / `redraft_games_count_choices`
 * arrive with migration `20261020190000_games_count_setting`. Leaving "All games" is refused until both
 * exist (`gamesCountTablesExist`, by effect with `to_regclass`), so it opens by itself once the migration
 * is applied. Going BACK to "All games" never needs the tables.
 */

export type GamesCountRefusal = { status: number; code: string; message: string }

export type SeasonForGamesCountSwitch = { sport: string; season: number; status: string | null }

export function sameGamesCountSetting(a: GamesCountSetting, b: GamesCountSetting): boolean {
  if (a.mode !== b.mode) return false
  return a.mode !== 'best_n' || a.n === (b as { n: number }).n
}

/** Pure timing rule. `setup` and `complete` seasons never block; any other season blocks once week 1 has begun. */
export function gamesCountTimingRefusal(seasons: readonly SeasonForGamesCountSwitch[], now: Date): GamesCountRefusal | null {
  for (const s of seasons) {
    const status = normalizeRedraftSeasonStatus(s.status)
    if (status === REDRAFT_SEASON_STATUS.SETUP || status === REDRAFT_SEASON_STATUS.COMPLETE) continue
    const week1 = resolveDailySportWeekWindow(s.sport, s.season, 1)
    if (week1 && week1.start.getTime() > now.getTime()) continue
    return {
      status: 409,
      code: 'games_count_season_in_progress',
      message:
        `Which games count can change only before the season's first week starts or after the season ends. ` +
        `The ${s.season} season is under way, and every week must be scored under one rule.`,
    }
  }
  return null
}

type SwitchDb = {
  redraftSeason: { findMany(args: unknown): Promise<SeasonForGamesCountSwitch[]> }
}

/** Whether the league may move from `from` to `to` now. `null` = allowed (including no change). */
export async function gamesCountChangeRefusal(
  args: { leagueId: string; from: GamesCountSetting; to: GamesCountSetting; now?: Date },
  db: unknown = prisma,
): Promise<GamesCountRefusal | null> {
  if (sameGamesCountSetting(args.from, args.to)) return null
  const seasons = await (db as SwitchDb).redraftSeason.findMany({
    where: { leagueId: args.leagueId },
    select: { sport: true, season: true, status: true },
  })
  const timing = gamesCountTimingRefusal(seasons, args.now ?? new Date())
  if (timing) return timing
  if (args.to.mode !== 'all' && !(await gamesCountTablesExist(db))) {
    return {
      status: 409,
      code: 'games_count_storage_unavailable',
      message: 'Best-N and Lock-In are not available yet on this server. "All games" stays in effect.',
    }
  }
  return null
}

function plain(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * A `sportConfig` written wholesale that does not MENTION the two keys keeps the stored values, so a
 * blob saved from a copy that predates the setting cannot silently turn it off (and step past the
 * timing rule). A blob that names either key is taken as written. `null` (clear the blob) is treated
 * as a blob without the keys.
 */
export function keepGamesCountFields(stored: unknown, incoming: unknown): Record<string, unknown> | null {
  const inc = incoming === null ? null : plain(incoming)
  if (inc && (GAMES_COUNT_MODE_KEY in inc || GAMES_COUNT_BEST_N_KEY in inc)) return inc
  const st = plain(stored) ?? {}
  const kept: Record<string, unknown> = {}
  if (st[GAMES_COUNT_MODE_KEY] !== undefined) kept[GAMES_COUNT_MODE_KEY] = st[GAMES_COUNT_MODE_KEY]
  if (st[GAMES_COUNT_BEST_N_KEY] !== undefined) kept[GAMES_COUNT_BEST_N_KEY] = st[GAMES_COUNT_BEST_N_KEY]
  if (Object.keys(kept).length === 0) return inc
  return { ...(inc ?? {}), ...kept }
}

/** The setting a `sportConfig` blob means for this sport (`null` blob = "All games"). */
export function gamesCountSettingOf(sportConfig: unknown, sport: string | null | undefined): GamesCountSetting {
  return readGamesCountSetting({ sportConfig: plain(sportConfig) ?? {} }, sport)
}
