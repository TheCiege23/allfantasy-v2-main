/**
 * Resolves full playoff config for a league (bracket + seeding + tiebreakers).
 * Used by app playoff/config API and PlayoffSettingsPanel.
 */
import { getBracketConfigForLeague } from './PlayoffBracketConfigResolver'
import { getSeedingRulesForLeague } from './PlayoffSeedingResolver'
import { getStandingsTiebreakersForLeague } from './StandingsTiebreakerResolver'

export interface PlayoffConfigForLeague {
  playoff_team_count: number
  playoff_weeks: number
  playoff_start_week: number | null
  playoff_start_point: number | null
  first_round_byes: number
  bracket_type: string
  matchup_length: number
  total_rounds: number | null
  consolation_bracket_enabled: boolean
  third_place_game_enabled: boolean
  toilet_bowl_enabled: boolean
  championship_length: number
  consolation_plays_for: string
  consolation_pick_goes_to: string
  draft_order_carries_over: boolean
  seeding_rules: string
  tiebreaker_rules: string[]
  bye_rules: string | null
  reseed_behavior: string
  standings_tiebreakers: string[]
  sport: string
  variant: string | null
}

export async function getPlayoffConfigForLeague(leagueId: string): Promise<PlayoffConfigForLeague | null> {
  const [bracket, seeding, tiebreakers] = await Promise.all([
    getBracketConfigForLeague(leagueId),
    getSeedingRulesForLeague(leagueId),
    getStandingsTiebreakersForLeague(leagueId),
  ])
  if (!bracket) return null
  return {
    ...bracket,
    seeding_rules: seeding?.seeding_rules ?? 'standard_standings',
    tiebreaker_rules: seeding?.tiebreaker_rules ?? [],
    bye_rules: seeding?.bye_rules ?? null,
    reseed_behavior: seeding?.reseed_behavior ?? 'fixed_bracket',
    standings_tiebreakers: tiebreakers?.tiebreakers ?? [],
    sport: bracket.sport,
    variant: bracket.variant,
  }
}
