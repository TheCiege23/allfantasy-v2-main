import 'server-only'

import { prisma } from '@/lib/prisma'
import { getAllCanonicalTeams, normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * A team's bye week, derived from the schedule.
 *
 * There is no bye-week COLUMN anywhere that holds data. `RedraftRosterPlayer.byeWeek` and
 * `DraftPick.byeWeek` are real `Int?` columns that nothing fills — 60,909 of 60,911 rows were null
 * — and `fantasy_players.bye_week` exists on a table with ZERO rows. The fact is derivable instead:
 * a team's bye is the regular-season week it has no game.
 *
 * `lib/decision-os/world/scheduleBye.ts` already does this and applies the same one-gap rule, but
 * only inside the Decision OS canonical-world pipeline, which the trade path never runs. This is
 * the same rule reachable from a request.
 *
 * Measured on production 2026-09-04, NFL 2026: 32 teams, 32 with exactly one gap, 0 ambiguous,
 * all 32 mapping to a canonical abbreviation.
 */

/**
 * ⚠ THE SEASON IS A PARAMETER AND `max(season)` IS NEVER USED, WHICH IS NOT FUSSINESS.
 * `SportsGame` contains two rows for season **2099**. Deriving with `max(season)` picks them and
 * collapses the whole calculation to 4 teams over 1 week, yielding zero byes and looking like a
 * schedule that simply is not loaded. Callers pass the LEAGUE's own season; all 260 NFL leagues
 * carry one, so there is nothing to fall back to.
 */
export async function resolveTeamByeWeeks(
  sport: string,
  season: number | null | undefined,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  /*
   * 🛑 THE UPPER BOUND IS "NEXT YEAR", NOT A ROUND NUMBER, AND THE FIRST VERSION OF THIS GUARD WAS
   * USELESS. It read `yr > 2100`, which lets 2099 straight through — the exact row it existed to
   * exclude. A bound only works if it is tighter than the bad data. No schedule exists for a season
   * beyond the next one, so that is the real limit.
   */
  const yr = Number(season)
  const maxPlausible = new Date().getUTCFullYear() + 1
  if (!Number.isInteger(yr) || yr < 2000 || yr > maxPlausible) return out

  /*
   * ⚠ `seasonType = 'regular'` IS LOAD-BEARING TWICE OVER.
   *
   * It excludes preseason, obviously. Less obviously, this table holds the SAME season under two
   * spellings written by different importers, and they disagree about how a team is named:
   * `regular` rows say "Arizona Cardinals", rows with a NULL seasonType say "ARI". Taking both
   * turns 32 teams into 65, makes 33 of them ambiguous, and drags in a stale "St. Louis Rams" row
   * with a gap in all 18 weeks.
   */
  const rows = await prisma.$queryRaw<Array<{ team: string; bye: number }>>`
    WITH wk AS (
      SELECT DISTINCT week FROM "SportsGame"
      WHERE sport = ${sport} AND season = ${yr} AND week > 0
        AND lower(coalesce("seasonType", '')) = 'regular'
    ),
    tm AS (
      SELECT DISTINCT "homeTeam" AS team FROM "SportsGame"
      WHERE sport = ${sport} AND season = ${yr} AND "homeTeam" <> ''
        AND lower(coalesce("seasonType", '')) = 'regular'
      UNION
      SELECT DISTINCT "awayTeam" FROM "SportsGame"
      WHERE sport = ${sport} AND season = ${yr} AND "awayTeam" <> ''
        AND lower(coalesce("seasonType", '')) = 'regular'
    ),
    pl AS (
      SELECT DISTINCT "homeTeam" AS team, week FROM "SportsGame"
      WHERE sport = ${sport} AND season = ${yr} AND week > 0
        AND lower(coalesce("seasonType", '')) = 'regular'
      UNION
      SELECT DISTINCT "awayTeam", week FROM "SportsGame"
      WHERE sport = ${sport} AND season = ${yr} AND week > 0
        AND lower(coalesce("seasonType", '')) = 'regular'
    )
    SELECT tm.team AS team, min(wk.week)::int AS bye
    FROM tm CROSS JOIN wk
    LEFT JOIN pl ON pl.team = tm.team AND pl.week = wk.week
    WHERE pl.team IS NULL
    GROUP BY tm.team
    /*
     * 🛑 EXACTLY ONE GAP, OR NOTHING. Two gaps means the schedule is incomplete for that team, and
     * a "first gap" would then be a guess presented as a fact — on a screen where a manager plans
     * around it. Same rule as scheduleBye.ts: ambiguous stays absent.
     */
    HAVING count(*) = 1
  `.catch(() => [] as Array<{ team: string; bye: number }>)

  const canonical = new Set(getAllCanonicalTeams().map((t) => t.abbrev))
  for (const r of rows) {
    /*
     * ⚠ `normalizeTeamAbbrev` RETURNS ITS INPUT UPPERCASED WHEN NOTHING MATCHES, not null. So the
     * result is checked against the canonical set: without that, an unrecognised club would become
     * a plausible-looking key that silently never joins to a player.
     */
    const abbrev = normalizeTeamAbbrev(r.team)
    if (!abbrev || !canonical.has(abbrev)) continue
    if (r.bye == null) continue
    out.set(abbrev, Number(r.bye))
  }
  return out
}

/** Look a player's bye up by whatever spelling of the team we hold. */
export function byeForTeam(
  byes: Map<string, number>,
  team: string | null | undefined,
): number | null {
  if (!team) return null
  const abbrev = normalizeTeamAbbrev(team)
  if (!abbrev) return null
  return byes.get(abbrev) ?? null
}
