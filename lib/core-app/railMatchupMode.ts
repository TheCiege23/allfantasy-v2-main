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

export type EliminationFormat = 'guillotine' | 'survivor_guillotine'

/**
 * Is this league an elimination format — scored against the whole field, with no weekly opponent?
 *
 * 🛑 ONE RULE FOR EVERY SCREEN THAT DRAWS A HEAD-TO-HEAD. The rail already refused to pair a
 * guillotine league; the all-leagues matchup board and the one-league matchup page did not, so on
 * 2026-10-02 "Survivor All-Stars Guillotine" and "2026 BB Guilly League!" were ranked as ordinary
 * matchups with a win probability against a provider-assigned "opponent", right beside a rail that
 * correctly showed them as elimination rows.
 *
 * The confirmed type wins over the column, as the rail has always read it. ⚠ `guillotineMode` is
 * checked INDEPENDENTLY of the type: a best-ball guillotine league's type is `best_ball`, so a test on
 * the type alone drops it. ⚠ And older leagues carry the flag only inside `settings` (measured
 * 2026-09-08: the column finds 12 of the 14 elimination leagues; settings finds all 14).
 */
export function eliminationFormat(league: {
  leagueType?: string | null
  guillotineMode?: boolean | null
  settings?: unknown
  /** The rail reads this as a SQL subpath; everyone else passes `settings` and it is read from there. */
  confirmedType?: string | null
}): EliminationFormat | null {
  const settings =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const confirmation = settings.leagueTypeConfirmation
  const confirmed =
    league.confirmedType ??
    (confirmation && typeof confirmation === 'object' && !Array.isArray(confirmation)
      ? (confirmation as Record<string, unknown>).type
      : null)
  const raw =
    [confirmed, league.leagueType, settings.league_type, settings.leagueType].find(
      (t): t is string => typeof t === 'string' && t.trim() !== '',
    ) ?? ''
  const type = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (type.includes('guillotine')) return type.includes('survivor') ? 'survivor_guillotine' : 'guillotine'
  if (
    league.guillotineMode === true ||
    settings.guillotineMode === true ||
    settings.guillotine_mode === true
  ) {
    return 'guillotine'
  }
  return null
}
