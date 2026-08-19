/**
 * User OS League-Specific Intelligence Wiring phase — Part 10, playoff-path
 * domain.
 *
 * Never triggers a new `SeasonForecastEngine` simulation run — reads the
 * real, already-persisted `SeasonForecastSnapshot` (via `UserOsContext.playoffForecastByTeamId`)
 * when one exists. When none exists, falls back to a real, qualitative,
 * standings-based read using the league's own real `playoffTeams` setting
 * — never assumes 6 playoff teams or a default bracket shape, and never
 * shows a fabricated numeric probability. This matches Part 10's own
 * explicit instruction for exactly this situation.
 */
import type { UserOsContext } from '../userOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../types'

const FORECAST_STALE_AFTER_WEEKS = 2

export function generatePlayoffRecommendations(context: UserOsContext, generatedAt: string): LeagueRecommendation[] {
  if (context.unavailableDomains.includes('playoff') || !context.teamId || !context.viewerTeam) return []

  const forecast = context.playoffForecastByTeamId?.get(context.teamId) ?? null
  const forecastIsFresh =
    forecast !== null &&
    context.latestForecastWeek !== null &&
    context.currentWeek - context.latestForecastWeek <= FORECAST_STALE_AFTER_WEEKS

  if (forecast && forecastIsFresh) {
    const priority = forecast.playoffProbability < 0.35 ? 'high' : 'medium'
    if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []
    return [
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        teamId: context.teamId,
        rosterId: context.rosterId ?? undefined,
        domain: 'playoff',
        type: 'playoff_probability',
        key: `week-${context.latestForecastWeek}`,
        priority,
        title: `${(forecast.playoffProbability * 100).toFixed(0)}% playoff probability`,
        summary: `Based on the week ${context.latestForecastWeek} simulation, your team has a ${(forecast.playoffProbability * 100).toFixed(0)}% chance of making the playoffs (projected seed ${forecast.expectedFinalSeed.toFixed(1)}).`,
        rationale: [`Real ${context.playoffTeams ?? 'league-configured'}-team playoff simulation from SeasonForecastSnapshot, week ${context.latestForecastWeek}.`],
        evidence: [
          { label: 'Playoff probability', detail: `${(forecast.playoffProbability * 100).toFixed(0)}%`, source: 'SeasonForecastSnapshot' },
          { label: 'Projected seed', detail: forecast.expectedFinalSeed.toFixed(1), source: 'SeasonForecastSnapshot' },
        ],
        confidence: 0.7,
        sourceFreshness: context.syncFreshness,
        executionCapability: 'recommendation_only',
        generatedAt,
      }),
    ]
  }

  // Honest qualitative fallback — no fabricated numeric probability.
  if (context.playoffTeams === null) {
    // Cannot even say "would make it" without knowing how many spots exist — genuinely unavailable.
    return []
  }
  const sorted = [...context.standings].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.pointsFor - a.pointsFor
  })
  const rankIndex = sorted.findIndex((t) => t.teamId === context.teamId)
  const wouldMakePlayoffs = rankIndex >= 0 && rankIndex < context.playoffTeams
  const spotsFromCutoff = rankIndex - context.playoffTeams + 1

  const priority = wouldMakePlayoffs ? 'low' : 'medium'
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      teamId: context.teamId,
      rosterId: context.rosterId ?? undefined,
      domain: 'playoff',
      type: 'playoff_position_qualitative',
      key: 'standings-based',
      priority,
      title: wouldMakePlayoffs
        ? `Currently inside the playoff picture (#${rankIndex + 1} of ${context.playoffTeams} spots)`
        : `Currently outside the playoff picture (#${rankIndex + 1}, ${spotsFromCutoff} spot(s) back)`,
      summary: `Based on current standings alone (no simulation available yet), your team is #${rankIndex + 1} in a ${context.playoffTeams}-team playoff format.`,
      rationale: [
        'Numeric playoff probability is unavailable — no recent season simulation exists for this league.',
        `Real league setting: ${context.playoffTeams} playoff spots, starting week ${context.playoffStartWeek ?? 'unknown'}.`,
      ],
      evidence: [
        { label: 'Current rank', detail: `#${rankIndex + 1} of ${context.standings.length}`, source: 'LeagueTeam' },
        { label: 'Playoff spots', detail: String(context.playoffTeams), source: 'League.playoffTeams' },
      ],
      sourceFreshness: context.syncFreshness,
      executionCapability: 'recommendation_only',
      generatedAt,
    }),
  ]
}
