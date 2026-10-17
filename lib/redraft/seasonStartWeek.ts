/**
 * The week a newly drafted season STARTS — the first real-world week of its sport that has not
 * kicked off yet, not always week 1.
 *
 * 🛑 A LEAGUE THAT FINISHED DRAFTING MID-SEASON WAS SCORED RETROACTIVELY AND THEN STUCK FOREVER.
 * Every season was created at `currentWeek: 1` with matchups for weeks 1..regular-season end, and
 * week numbers ARE the sport's weeks (`mapSportWeekToLeagueWeek` passes no anchor). So a league
 * drafted in NFL week 5 was scored on weeks 1-4 — games played before anyone drafted — and then the
 * finalizer, which only sweeps `WEEK_FINALIZE_LOOKBACK_WEEKS` (3) behind the current week, never
 * looked at week 1 again: its matchups never went final, the roller never advanced, and the league
 * sat at week 1 for good with nothing red anywhere. Found 2026-09-28 while making NCAAF
 * season-capable (college football was at week 5); every sport had it.
 *
 * Owner's ruling (2026-09-28): a late league starts at the next unplayed week. Week numbers stay the
 * sport's own, so nothing downstream maps anything — the season simply has no matchups before its
 * first week and a shorter regular season.
 *
 * A season drafted before its sport has started, or whose sport's week cannot be read, starts at
 * week 1 exactly as before. The start never passes the last regular-season week: a league drafted
 * after that still gets one regular week rather than none.
 */
import type { PrismaClient } from '@prisma/client'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import type { SportWeekResolution } from '@/lib/season-week/types'

export type SeasonStartWeek = {
  startWeek: number
  /** Why this week — for the draft-completion log, so a late start is never a mystery. */
  reason: 'sport_not_started' | 'next_unplayed_week' | 'clamped_to_last_regular_week' | 'week_unknown' | 'postseason'
}

export async function resolveSeasonStartWeek(
  args: { sport: string; seasonYear: number; regularSeasonEnd: number },
  deps: { prisma?: PrismaClient; now?: Date; resolve?: typeof resolveSportWeek } = {},
): Promise<SeasonStartWeek> {
  const regularEnd = Math.max(1, Math.floor(args.regularSeasonEnd))
  let resolution: SportWeekResolution
  try {
    resolution = await (deps.resolve ?? resolveSportWeek)(args.sport, args.seasonYear, { prisma: deps.prisma, now: deps.now })
  } catch {
    return { startWeek: 1, reason: 'week_unknown' }
  }
  if (!resolution.ok) return { startWeek: 1, reason: 'week_unknown' }
  // A postseason week number is not a regular-season week; nothing sensible to start on.
  if (resolution.seasonType !== 'regular') return { startWeek: 1, reason: 'postseason' }

  const wanted = resolution.state === 'upcoming'
    ? resolution.sportWeek
    : (resolution.nextSportWeek ?? resolution.sportWeek + 1)
  if (wanted <= 1) return { startWeek: 1, reason: 'sport_not_started' }
  if (wanted > regularEnd) return { startWeek: regularEnd, reason: 'clamped_to_last_regular_week' }
  return { startWeek: wanted, reason: 'next_unplayed_week' }
}
