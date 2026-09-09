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

export interface WindowFactsPort {
  identity(scope: WindowFactsScope): Promise<TeamIdentity | null>
  allPlay(scope: WindowFactsScope): Promise<AllPlayRecord | null>
  forecast(scope: WindowFactsScope): Promise<StoredForecast | null>
  dynasty(scope: WindowFactsScope): Promise<StoredDynastyProjection | null>
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
  dynasty: StoredDynastyProjection | null
  injuries: InjuryLoad | null
  /** When the assembly ran. Distinct from when any producer generated its row. */
  assembledAt: string
}

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
  now: Date = new Date(),
): Promise<WindowFactsResult> {
  const assembledAt = now.toISOString()
  const empty: WindowEvidence = { identity: null, allPlay: null, forecast: null, dynasty: null, injuries: null, assembledAt }

  if (!scope.leagueId || !scope.teamId || !Number.isInteger(scope.season) ||
      !Number.isInteger(scope.week) || scope.week < 1) {
    return { facts: null, evidence: empty, gaps: ['window_scope_invalid'] }
  }

  const [identity, record, forecast, dynasty, injuries] = await Promise.all([
    port.identity(scope), port.allPlay(scope), port.forecast(scope), port.dynasty(scope), port.injuries(scope),
  ])
  const evidence: WindowEvidence = { identity, allPlay: record, forecast, dynasty, injuries, assembledAt }

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

  let rosterStrength3Year: number | null = null
  if (!dynasty) gaps.push('dynasty_projection_missing')
  else if (dynasty.season !== scope.season) gaps.push('dynasty_projection_wrong_season')
  else {
    rosterStrength3Year = pctToUnit(dynasty.projectedStrength3YearsPct)
    if (rosterStrength3Year === null) gaps.push('dynasty_projection_strength_out_of_range')
  }

  if (!injuries) gaps.push('injury_load_missing')
  else if (!Number.isFinite(injuries.coverage) || injuries.coverage < MIN_INJURY_COVERAGE) gaps.push('injury_coverage_below_floor')

  if (gaps.length) return { facts: null, evidence, gaps }

  return {
    gaps: [],
    evidence,
    facts: {
      teamId: scope.teamId,
      leagueId: scope.leagueId,
      season: scope.season,
      week: scope.week,
      wins: record!.wins,
      losses: record!.losses,
      ties: record!.ties,
      luckWins: record!.luckWins,
      playoffProbability,
      rosterStrength3Year,
      // The persisted dynasty strength already blends pick capital in.
      futurePickCapital: null,
      pickTreatment: 'included-in-roster-strength',
      unavailableShare: injuries!.unavailableShare,
      injuryTreatment: injuries!.treatment,
    },
  }
}
