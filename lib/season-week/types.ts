/**
 * Shared vocabulary for "what week is this league on right now".
 *
 * Every type here is deliberately explicit about NOT KNOWING. The resolver's
 * whole job is to answer a question that four callers currently answer by
 * guessing — `Math.max(1, currentWeek || 1)`, a month check, a bare `|| 1` —
 * and a guess is worse than a refusal here: a wrong week fetches a real but
 * irrelevant slate and writes plausible, wrong rows. `resolveSlate` in
 * `server/services/liveScoring/liveScoreRunner.ts` already established that
 * shape ("RETURNS THE CALENDAR FALLBACK RATHER THAN GUESSING A WEEK"); this
 * module follows it.
 */

/** The sport's own week vocabulary, matching `SportsGame.seasonType`. */
export type ScheduleSeasonType = 'pre' | 'regular' | 'post'

/**
 * Where a sport week sits relative to `now`.
 *
 * `played` is the only state that means "this week is over" — `between` covers
 * the case where the last kickoff has passed but a game is still unfinal
 * (a postponement, or a feed that has not caught up), which must NOT be
 * mistaken for a finished week.
 */
export type SportWeekState = 'upcoming' | 'live' | 'between' | 'played'

/** Where a league sits in its own season, independent of the sport's calendar. */
export type SeasonWeekPhase = 'preseason' | 'regular' | 'playoffs' | 'season_complete'

/** Why the resolver declined to name a week. Never substituted with a number. */
export type SeasonWeekUnknownReason =
  /** The sport's schedule feed does not carry a usable week — see `sportWeekSignal.ts`. */
  | 'NO_WEEK_SIGNAL'
  /** No schedule rows at all for this sport/season. */
  | 'NO_SCHEDULE_ROWS'
  /** Rows exist but none carries both a week and a kickoff time. */
  | 'NO_DATED_ROWS'
  /** Rows exist and carry weeks, but the week numbering fails the plausibility check. */
  | 'IMPLAUSIBLE_WEEKS'

/** One sport week's slate, reduced to what a scheduling decision needs. */
export type SportWeekSlate = {
  week: number
  seasonType: ScheduleSeasonType
  /** Games after single-source dedup — see `pickFreshestSourceRows`. */
  gameCount: number
  firstKickoffAt: Date
  lastKickoffAt: Date
  liveCount: number
  finalCount: number
  /** Every game in the slate carries a final status. */
  allFinal: boolean
}

/** One schedule row, reduced to what week resolution needs. */
export type ScheduleRow = {
  week: number | null
  seasonType: string | null
  startTime: Date | null
  status: string | null
  /** Required for dedup: this table keeps one row PER SOURCE per fixture. */
  source: string | null
  fetchedAt: Date | null
}

export type SportWeekResolution =
  | {
      ok: true
      /**
       * The real-world week the sport is on. During the gap between weeks this
       * is the week just finished, not the one about to start — `state` and
       * `nextSportWeek` carry that distinction so a caller never has to infer it.
       */
      sportWeek: number
      seasonType: ScheduleSeasonType
      state: SportWeekState
      slate: SportWeekSlate
      /** The next week present on the schedule, or null at the end of the season. */
      nextSportWeek: number | null
      source: 'schedule'
    }
  | { ok: false; reason: SeasonWeekUnknownReason }

/** The shape of a league's own season, as the resolver needs to see it. */
export type LeagueSeasonShape = {
  sport: string
  seasonYear: number
  /** Regular-season length as stored on `RedraftSeason.totalWeeks`. */
  totalWeeks: number
  /** First playoff week as stored on `RedraftSeason.playoffStartWeek`. */
  playoffStartWeek: number
  /**
   * Which SPORT week the league's fantasy week 1 maps to. Defaults to 1 — the
   * case for every league that drafts before kickoff. A league that starts late
   * sets this; nothing in the schema stores it yet, so callers pass it.
   */
  anchorSportWeek?: number
}

export type LeagueSeasonWeekResolution =
  | {
      ok: true
      /** The league's own week, 1-based, clamped to the league's shape. */
      fantasyWeek: number
      /** The sport week `fantasyWeek` was derived from. */
      sportWeek: number
      phase: SeasonWeekPhase
      state: SportWeekState
      /**
       * The sport week backing `fantasyWeek` has every game final. This is the
       * real-world half of "is it safe to roll the league forward"; the fantasy
       * half (every matchup finalized) already lives in the schedule runtime and
       * is deliberately NOT duplicated here.
       */
      sportWeekComplete: boolean
      /** Null in preseason, where there is no played slate to describe. */
      slate: SportWeekSlate | null
      source: 'schedule'
    }
  | { ok: false; reason: SeasonWeekUnknownReason }
