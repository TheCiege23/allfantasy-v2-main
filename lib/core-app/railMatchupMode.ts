export type RailMatchupMode = 'head_to_head' | 'elimination' | 'unpaired'

/**
 * League format wins over a provider pairing. Some providers assign matchup
 * ids inside guillotine leagues even though the manager competes against the
 * whole field, so a paired row must never force a fake versus presentation.
 */
export function resolveRailMatchupMode(
  elimination: boolean,
  hasOpponent: boolean,
): RailMatchupMode {
  if (elimination) return 'elimination'
  return hasOpponent ? 'head_to_head' : 'unpaired'
}

