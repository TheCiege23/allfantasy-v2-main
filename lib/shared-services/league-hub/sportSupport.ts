/**
 * User OS League-Specific Intelligence Wiring phase — Part 16, multi-sport
 * seam. A single, explicit source of truth for which domain generators are
 * physically proven/implemented for which sport this phase — never
 * inferred implicitly inside a generator, and never silently defaulting to
 * "supported." `userOsContext.ts`'s `unavailableDomains` reads this table
 * directly so a new sport or domain only needs one entry updated here.
 *
 * Real state this phase: only NFL has real domain logic (built directly
 * from canonical `Roster.playerData`/`InjuryReportRecord`, both populated
 * for NFL data today). NBA/MLB/NHL/soccer/college football/college
 * basketball get an honest `unsupported` marker for every domain rather
 * than NFL-shaped logic silently misapplied (weekly cadence, bye weeks,
 * lock-time assumptions that don't hold for daily-cadence sports).
 * `roster`/`playoff`/`strategy` are marked sport-neutral where their real
 * inputs (win/loss record, `SeasonForecastSnapshot`) are not NFL-specific —
 * but `playoff`/`strategy` still require real per-league data to exist
 * regardless of sport, so "listed as supported" here does not guarantee a
 * result for every league.
 */
import type { LeagueRecommendationDomain } from './types'

const NFL_ONLY_DOMAINS: readonly Exclude<LeagueRecommendationDomain, 'commissioner'>[] = ['lineup', 'waiver']

const SPORT_NEUTRAL_DOMAINS: readonly Exclude<LeagueRecommendationDomain, 'commissioner'>[] = [
  'roster',
  'trade',
  'playoff',
  'strategy',
]

/** True when this domain has real, physically-implemented logic for this sport this phase. */
export function isDomainSupportedForSport(
  domain: Exclude<LeagueRecommendationDomain, 'commissioner'>,
  sport: string
): boolean {
  const normalized = sport.toUpperCase()
  if (SPORT_NEUTRAL_DOMAINS.includes(domain)) return true
  if (NFL_ONLY_DOMAINS.includes(domain)) return normalized === 'NFL'
  return false
}

export const SUPPORTED_SPORTS_THIS_PHASE: readonly string[] = ['NFL']
export const SPORT_NEUTRAL_DOMAINS_LIST = SPORT_NEUTRAL_DOMAINS
export const NFL_ONLY_DOMAINS_LIST = NFL_ONLY_DOMAINS
