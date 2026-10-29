import { prisma } from '@/lib/prisma'
import { normalizeRedraftSeasonStatus, REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import { isSealedWeek } from '@/lib/redraft/weekSealed'

/**
 * When the commissioner may turn the league median game (`League.medianGame`, lib/redraft/medianGame.ts)
 * on or off. The settings PATCH asks this before it writes the column.
 *
 * 🛑 NOT ONCE THE SEASON'S FIRST WEEK IS FINAL. Standings recompute every record from the start of the
 * season, so flipping the median mid-season adds or removes a median result in EVERY played week: a 6-2
 * team becomes 11-5 or the reverse, and the seeds move with it. Nothing existed to stop that — the
 * scoring lifecycle gate only watches the `scoring` key — so the rule is set here (owner's decision,
 * 2026-10-25): a change is open until the season's first week is sealed (every real matchup in it
 * `final`, lib/redraft/weekSealed.ts), and again once the season is `complete`. A final result in any
 * later week also locks it, so a first week that never sealed cannot keep the door open over a season
 * already being played.
 *
 * Only a real change is checked: re-saving the stored value is never refused.
 */

export type MedianGameSwitchRefusal = { status: number; code: string; message: string }

export type MedianSwitchMatchup = { week: number; status: string | null; awayRosterId: string | null }
export type SeasonForMedianSwitch = { season: number; status: string | null; schedule: MedianSwitchMatchup[] }

/** True once a season has a played week on record: its first week sealed, or any later result final. */
export function seasonHasFinalWeek(schedule: readonly MedianSwitchMatchup[]): boolean {
  const real = schedule.filter((m) => m.awayRosterId !== null)
  if (real.length === 0) return false
  const firstWeek = Math.min(...real.map((m) => m.week))
  if (isSealedWeek(real.filter((m) => m.week === firstWeek))) return true
  return real.some((m) => m.week > firstWeek && m.status === 'final')
}

/** Pure timing rule. A `complete` season never blocks; any other season blocks once a week is final. */
export function medianGameTimingRefusal(seasons: readonly SeasonForMedianSwitch[]): MedianGameSwitchRefusal | null {
  for (const s of seasons) {
    if (normalizeRedraftSeasonStatus(s.status) === REDRAFT_SEASON_STATUS.COMPLETE) continue
    if (!seasonHasFinalWeek(s.schedule)) continue
    return {
      status: 409,
      code: 'median_game_season_in_progress',
      message:
        `The league median game can change only until the season's first week is final. ` +
        `The ${s.season} season already has final results, and changing it would rewrite every team's record.`,
    }
  }
  return null
}

type SwitchDb = {
  redraftSeason: { findMany(args: unknown): Promise<SeasonForMedianSwitch[]> }
}

/** Whether the league may move the median game from `from` to `to` now. `null` = allowed (including no change). */
export async function medianGameChangeRefusal(
  args: { leagueId: string; from: boolean; to: boolean },
  db: unknown = prisma,
): Promise<MedianGameSwitchRefusal | null> {
  if (args.from === args.to) return null
  const seasons = await (db as SwitchDb).redraftSeason.findMany({
    where: { leagueId: args.leagueId },
    select: {
      season: true,
      status: true,
      schedule: { where: { isMedianMatchup: false }, select: { week: true, status: true, awayRosterId: true } },
    },
  })
  return medianGameTimingRefusal(seasons)
}
