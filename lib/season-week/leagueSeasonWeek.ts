/**
 * Map "what week is the SPORT on" onto "what week is this LEAGUE on".
 *
 * These are two different questions and the codebase has been conflating them.
 * `liveScoreRunner.ts` already carries the note that started this
 * ("THE FANTASY WEEK AND THE REAL-WORLD WEEK ARE ONLY THE SAME THING IN THE
 * REGULAR SEASON"), and it is right — but it resolves the sport week from the
 * schedule while still taking the fantasy week from `RedraftSeason.currentWeek`,
 * a column nothing in the product increments. This module is the missing half.
 */

import type {
  LeagueSeasonShape,
  LeagueSeasonWeekResolution,
  SeasonWeekPhase,
  SportWeekResolution,
} from './types'

/**
 * The last regular-season week, computed the same way the scheduler computes it.
 *
 * ⚠ `totalWeeks` MEANS DIFFERENT THINGS TO THE TWO WRITERS, so it cannot be used
 * bare. `lib/league-import/canonicalSeasonMaterialization.ts` stores
 * `playoffStartWeek - 1` (a regular-season length); `finalizeDraftToRedraftSeason.ts`
 * stores `sportConfig.defaultSeasonWeeks`, which for NFL is 17 against a playoff
 * start of 15 — i.e. the whole season including playoffs. `generateSchedule` in
 * `lib/redraft/scheduleEngine.ts` already reconciles them with exactly this
 * expression, and matching it is what keeps the resolver and the schedule from
 * disagreeing about where the regular season ends.
 */
export function resolveRegularSeasonEndWeek(shape: {
  totalWeeks: number
  playoffStartWeek: number
}): number {
  return Math.min(shape.totalWeeks, Math.max(1, shape.playoffStartWeek - 1))
}

function phaseFor(
  fantasyWeek: number,
  shape: LeagueSeasonShape & { lastPlayoffWeek?: number },
): SeasonWeekPhase {
  if (fantasyWeek < 1) return 'preseason'
  if (shape.lastPlayoffWeek != null && fantasyWeek > shape.lastPlayoffWeek) {
    return 'season_complete'
  }
  return fantasyWeek >= shape.playoffStartWeek ? 'playoffs' : 'regular'
}

/**
 * Convert a resolved sport week into the league's own week.
 *
 * ⚠ NO `season_complete` IS EMITTED WITHOUT `lastPlayoffWeek`, AND THAT IS
 * DELIBERATE. Nothing on `RedraftSeason` records how many playoff rounds a
 * league runs — `RedraftPlayoffRound` does, and it is the only honest source.
 * Guessing three rounds because the NFL usually runs three would end a league's
 * season early on nothing but a convention, so the caller supplies the number or
 * the phase stops at `playoffs` and the bracket decides.
 */
export function mapSportWeekToLeagueWeek(
  sportWeek: SportWeekResolution,
  shape: LeagueSeasonShape & { lastPlayoffWeek?: number },
): LeagueSeasonWeekResolution {
  if (!sportWeek.ok) return sportWeek

  const anchor = Math.max(1, shape.anchorSportWeek ?? 1)
  const rawFantasyWeek = sportWeek.sportWeek - anchor + 1

  // Before the league's own week 1 — either the sport has not kicked off, or the
  // league starts later than the sport does. Both are preseason to the league,
  // and neither has a played slate to describe.
  if (rawFantasyWeek < 1 || sportWeek.state === 'upcoming') {
    return {
      ok: true,
      fantasyWeek: 1,
      sportWeek: sportWeek.sportWeek,
      phase: 'preseason',
      state: sportWeek.state,
      sportWeekComplete: false,
      slate: null,
      source: 'schedule',
    }
  }

  return {
    ok: true,
    fantasyWeek: rawFantasyWeek,
    sportWeek: sportWeek.sportWeek,
    phase: phaseFor(rawFantasyWeek, shape),
    state: sportWeek.state,
    // `allFinal` alone is not enough: a slate whose rows are all final but whose
    // last kickoff is still in the future is a feed artifact, not a played week.
    sportWeekComplete: sportWeek.state === 'played',
    slate: sportWeek.slate,
    source: 'schedule',
  }
}
