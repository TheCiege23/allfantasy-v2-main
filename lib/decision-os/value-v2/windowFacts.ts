import type { InjuryTreatment, TeamWindowFacts } from './window'

/**
 * Assembles `TeamWindowFacts` from persisted team facts.
 *
 * ⚠ TWO STORED SCALES ARE 0..100, AND THE RESOLVER TAKES 0..1.
 * `SeasonForecastSnapshot.teamForecasts[].playoffProbability` is a percentage
 * (`PlayoffOddsCalculator` multiplies the simulated share by 100), and
 * `DynastyProjectionSnapshot.projectedStrength3Years` is normalized to 0..100
 * by `LongTermStrengthEstimator`. Converting is a unit change with a named
 * source. A value outside its own declared range is a data fault and refuses —
 * it is never clamped into looking plausible.
 *
 * ⚠ A SNAPSHOT FROM AN EARLIER WEEK IS NOT AN ANSWER FOR THIS WEEK. Forecast
 * staleness is bounded explicitly, because a week-3 playoff probability read as
 * current is exactly the silently-wrong input the value contract exists to stop.
 */

export interface AllPlayRecord {
  wins: number
  losses: number
  ties: number
  /** Actual wins minus the wins the scoring earned. See `lib/core-app/allPlay.ts`. */
  luckWins: number
  /** Scored weeks the record was accumulated over. A week nobody scored is not a played week. */
  weeksCounted: number
  pointsFor: number
}

export interface TeamIdentity {
  /** The league-scoped roster/team id the facts are keyed on. */
  teamId: string
  teamName: string | null
  managerName: string | null
  /** Players on the roster the injury share was computed over. */
  rosterSize: number
}

export interface StoredForecast {
  season: number
  week: number
  /** 0..100, as persisted. */
  playoffProbabilityPct: number
  generatedAt: string | null
}

export interface StoredDynastyProjection {
  season: number
  /** 0..100, as persisted. Already contains future pick capital. */
  projectedStrength3YearsPct: number
  /** 0..100 next-season strength, carried as the short-term timeline half. */
  projectedStrengthNextYearPct: number | null
  /** Competitive-window timeline as the dynasty engine recorded it. */
  windowStartYear: number | null
  windowEndYear: number | null
  /** 0..100, the producing engine's own confidence. Provenance, never a decision branch. */
  confidencePct: number | null
  generatedAt: string | null
}

/**
 * ⚠ ONE INJURY FEED ONLY, AND THE OTHER TWO ARE NOT JOINABLE.
 * Decision OS F2.3 (`world/injuryEnrichedWorld.ts`) reads the `SportsPlayer`
 * cache, which is keyed on the same player ids as canonical rosters.
 * `InjuryReportRecord` and `InjuryReport` are keyed on API-Sports ids — a
 * different namespace — so merging them here would silently mis-join. The
 * adapter states the basis it actually used rather than leaving the reader to
 * assume a value-weighted starter figure.
 */
export interface InjuryLoad {
  /** 0..1 share of the covered roster currently categorised unavailable. */
  unavailableShare: number
  /** How the share was derived, carried into the consumer's provenance. */
  basis: string
  /** 0..1 share of the roster that had a resolved injury context at all. */
  coverage: number
  treatment: InjuryTreatment
}

/**
 * Rest-of-season roster strength for a REDRAFT team.
 *
 * 🛑 THE CANONICAL SOURCE IS `AFProjectionSnapshot`, AUDITED RATHER THAN INVENTED. That model
 * stores `afProjection` (PER GAME, the league-agnostic truth) and `rosProjection` (rest-of-season
 * total at a stated horizon) with `rosWeeksRemaining`, so a league-aware consumer can re-project
 * onto its own horizon. `lib/af-projections/restOfSeason.ts` is the ONE place the per-game →
 * rest-of-season multiplication may happen; its header records that feeding a per-game figure
 * where a season total belongs understates a player ~17× with no zero, no NaN and no error.
 *
 * ⚠ `rosProjection` NULL MEANS "NOT COMPUTED", NEVER ZERO — the column's own schema comment says
 * readers must fall back and never treat it as zero. A zeroed roster is indistinguishable from a
 * genuinely weak one, and it is exactly the shape that would classify a healthy contender as
 * rebuilding. Thin coverage refuses here rather than summing whatever happens to be present.
 *
 * `share` is LEAGUE-RELATIVE on purpose: projected points have no absolute scale, so the only
 * honest 0..1 figure is this roster's share of the league's remaining projected scoring, where
 * `1 / teamsCovered` is average.
 */
export interface RestOfSeasonStrength {
  /** 0..1 share of the league's remaining projected scoring held by this roster. */
  share: number
  /** How many of this roster's players had a computed projection. */
  playersCovered: number
  rosterSize: number
  /** Teams the share was computed across. A share means nothing without it. */
  teamsCovered: number
  /** Horizon the projections cover, as recorded by the producer. */
  weeksRemaining: number | null
  /** Names the producing store, carried into provenance. */
  source: string
  generatedAt: string | null
}

/** Which season horizon a league's window is judged over. Redraft never reaches past this season. */
export type WindowFormat = 'redraft' | 'dynasty'

export interface WindowFactsPort {
  identity(scope: WindowFactsScope): Promise<TeamIdentity | null>
  allPlay(scope: WindowFactsScope): Promise<AllPlayRecord | null>
  forecast(scope: WindowFactsScope): Promise<StoredForecast | null>
  /**
   * ⚠ DYNASTY ONLY, AND NOT CALLED AT ALL FOR A REDRAFT LEAGUE. Three- and five-year strength and
   * future pick capital describe seasons a redraft league does not have. Requiring them made every
   * redraft team unresolvable unless somebody had generated a dynasty projection for it and — far
   * worse — let a long-horizon number move a single-season verdict.
   */
  dynasty(scope: WindowFactsScope): Promise<StoredDynastyProjection | null>
  /** REDRAFT ONLY. Null when no trustworthy rest-of-season projection exists. */
  restOfSeason(scope: WindowFactsScope): Promise<RestOfSeasonStrength | null>
  /**
   * REDRAFT, OPTIONAL. 0..1 where 0.5 is an average remaining slate. Genuinely optional: null
   * omits it rather than refusing, because a league with no derivable strength-of-schedule is
   * still judgeable on record, playoff probability and roster strength.
   */
  remainingScheduleStrength?(scope: WindowFactsScope): Promise<number | null>
  /** Null when no trustworthy per-team injury load exists. It is not assumed healthy. */
  injuries(scope: WindowFactsScope): Promise<InjuryLoad | null>
}

export interface WindowFactsScope {
  leagueId: string
  teamId: string
  season: number
  week: number
}

/** A forecast older than this many weeks cannot stand in for the current one. */
export const MAX_FORECAST_WEEK_LAG = 1

/**
 * Below this, the unavailable share is measured over too little of the roster to
 * mean anything. A share of a fifth of a roster is not a roster's share.
 */
export const MIN_INJURY_COVERAGE = 0.5

export interface WindowEvidence {
  identity: TeamIdentity | null
  allPlay: AllPlayRecord | null
  forecast: StoredForecast | null
  /** Always null for a redraft league, because it is never read there. */
  dynasty: StoredDynastyProjection | null
  /** Always null for a dynasty league, because it is never read there. */
  restOfSeason: RestOfSeasonStrength | null
  remainingScheduleStrength: number | null
  injuries: InjuryLoad | null
  /** Which horizon this evidence was gathered for. */
  format: WindowFormat
  /** When the assembly ran. Distinct from when any producer generated its row. */
  assembledAt: string
}

/** Below this share of the roster, a rest-of-season total is not a roster's total. */
export const MIN_ROS_COVERAGE = 0.5

export interface WindowFactsResult {
  facts: TeamWindowFacts | null
  evidence: WindowEvidence
  gaps: string[]
}

function pctToUnit(pct: number | null | undefined): number | null {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : null
}

export async function assembleWindowFacts(
  scope: WindowFactsScope,
  port: WindowFactsPort,
  options: { format: WindowFormat; now?: Date } | Date = { format: 'dynasty' },
): Promise<WindowFactsResult> {
  /*
   * ⚠ THE DATE OVERLOAD IS FOR EXISTING DYNASTY CALLERS AND IS NOT A DEFAULT TO COPY. New callers
   * pass a format explicitly; a caller that does not say which horizon it means gets the dynasty
   * one, which is the pre-existing behaviour rather than a guess about their league.
   */
  const opts = options instanceof Date ? { format: 'dynasty' as WindowFormat, now: options } : options
  const format = opts.format
  const now = opts.now ?? new Date()
  const assembledAt = now.toISOString()
  const empty: WindowEvidence = {
    identity: null, allPlay: null, forecast: null, dynasty: null,
    restOfSeason: null, remainingScheduleStrength: null, injuries: null, format, assembledAt,
  }

  if (!scope.leagueId || !scope.teamId || !Number.isInteger(scope.season) ||
      !Number.isInteger(scope.week) || scope.week < 1) {
    return { facts: null, evidence: empty, gaps: ['window_scope_invalid'] }
  }

  const isRedraft = format === 'redraft'

  /*
   * 🛑 THE BRANCH IS ON WHAT IS *CALLED*, NOT ONLY ON WHAT IS REQUIRED. A redraft assembly that
   * still awaited `port.dynasty` would keep the query, keep its cost, and keep the possibility of
   * a long-horizon row reaching a single-season verdict through some later edit. Not calling it is
   * the property the tests assert, because it is the one that cannot rot into a soft dependency.
   */
  const [identity, record, forecast, dynasty, restOfSeason, scheduleStrength, injuries] = await Promise.all([
    port.identity(scope),
    port.allPlay(scope),
    port.forecast(scope),
    isRedraft ? Promise.resolve(null) : port.dynasty(scope),
    isRedraft ? port.restOfSeason(scope) : Promise.resolve(null),
    isRedraft && port.remainingScheduleStrength ? port.remainingScheduleStrength(scope) : Promise.resolve(null),
    port.injuries(scope),
  ])
  const evidence: WindowEvidence = {
    identity, allPlay: record, forecast, dynasty, restOfSeason,
    remainingScheduleStrength: scheduleStrength, injuries, format, assembledAt,
  }

  const gaps: string[] = []

  if (!identity) gaps.push('team_identity_missing')
  else if (identity.teamId !== scope.teamId) gaps.push('team_identity_mismatch')

  if (!record) gaps.push('all_play_record_missing')
  else if (record.weeksCounted <= 0) gaps.push('all_play_no_scored_weeks')

  let playoffProbability: number | null = null
  if (!forecast) gaps.push('season_forecast_missing')
  else if (forecast.season !== scope.season) gaps.push('season_forecast_wrong_season')
  else if (forecast.week > scope.week || scope.week - forecast.week > MAX_FORECAST_WEEK_LAG) gaps.push('season_forecast_stale')
  else {
    playoffProbability = pctToUnit(forecast.playoffProbabilityPct)
    if (playoffProbability === null) gaps.push('season_forecast_probability_out_of_range')
  }

  /*
   * The long-horizon half, for DYNASTY only. `rosterStrength3Year` is three seasons out and
   * already blends future pick capital in — neither is a fact about a redraft league, which is why
   * this whole branch is unreachable there rather than merely unused.
   */
  let rosterStrength3Year: number | null = null
  if (!isRedraft) {
    if (!dynasty) gaps.push('dynasty_projection_missing')
    else if (dynasty.season !== scope.season) gaps.push('dynasty_projection_wrong_season')
    else {
      rosterStrength3Year = pctToUnit(dynasty.projectedStrength3YearsPct)
      if (rosterStrength3Year === null) gaps.push('dynasty_projection_strength_out_of_range')
    }
  }

  /* The current-season half, for REDRAFT only. */
  let rosStrength: number | null = null
  if (isRedraft) {
    if (!restOfSeason) gaps.push('rest_of_season_projection_missing')
    else if (restOfSeason.rosterSize <= 0) gaps.push('rest_of_season_roster_empty')
    else if (restOfSeason.teamsCovered < 2) gaps.push('rest_of_season_league_not_comparable')
    else if (restOfSeason.playersCovered / restOfSeason.rosterSize < MIN_ROS_COVERAGE) {
      gaps.push('rest_of_season_coverage_below_floor')
    } else if (!Number.isFinite(restOfSeason.share) || restOfSeason.share < 0 || restOfSeason.share > 1) {
      gaps.push('rest_of_season_share_out_of_range')
    } else {
      rosStrength = restOfSeason.share
    }
  }

  if (!injuries) gaps.push('injury_load_missing')
  else if (!Number.isFinite(injuries.coverage) || injuries.coverage < MIN_INJURY_COVERAGE) gaps.push('injury_coverage_below_floor')

  if (gaps.length) return { facts: null, evidence, gaps }

  const shared = {
    teamId: scope.teamId,
    leagueId: scope.leagueId,
    season: scope.season,
    week: scope.week,
    wins: record!.wins,
    losses: record!.losses,
    ties: record!.ties,
    luckWins: record!.luckWins,
    playoffProbability,
    unavailableShare: injuries!.unavailableShare,
    injuryTreatment: injuries!.treatment,
  }

  return {
    gaps: [],
    evidence,
    facts: isRedraft
      ? {
          ...shared,
          format: 'redraft',
          restOfSeasonStrength: rosStrength,
          /*
           * A share above `1 / teamsCovered` is an above-average remaining slate of scoring. Kept
           * so a consumer can reason about it without re-deriving the league size.
           */
          leagueAverageShare: 1 / restOfSeason!.teamsCovered,
          remainingScheduleStrength: scheduleStrength,
        }
      : {
          ...shared,
          format: 'dynasty',
          rosterStrength3Year,
          // The persisted dynasty strength already blends pick capital in.
          futurePickCapital: null,
          pickTreatment: 'included-in-roster-strength',
        },
  }
}
