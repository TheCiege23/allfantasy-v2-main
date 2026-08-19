import 'server-only'
/**
 * Fantasy OS Phase 5E — runtime feature gates (Stop-gate 2).
 *
 * Every live sports-data integration is reversible via a server-only env gate, DISABLED BY DEFAULT. There is
 * no customer-controlled override and no fallback to fabricated data. The disabled path preserves existing
 * behavior; the enabled path only ADDS certified context. Season/cadence state is NOT controlled here — the
 * season resolver remains the source of truth.
 */
export type SportsDataSubsystem = 'lineup' | 'waiver' | 'trade' | 'draft' | 'matchup' | 'scoring' | 'intelligence' | 'coach' | 'observability'

const ENV_KEY: Record<SportsDataSubsystem, string> = {
  lineup: 'FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED',
  waiver: 'FANTASY_OS_SPORTS_DATA_WAIVER_ENABLED',
  trade: 'FANTASY_OS_SPORTS_DATA_TRADE_ENABLED',
  draft: 'FANTASY_OS_SPORTS_DATA_DRAFT_ENABLED',
  matchup: 'FANTASY_OS_SPORTS_DATA_MATCHUP_ENABLED',
  // Phase 5E-g — Scoring is independently reversible from Matchup (added to the registry, disabled by default).
  scoring: 'FANTASY_OS_SPORTS_DATA_SCORING_ENABLED',
  intelligence: 'FANTASY_OS_SPORTS_DATA_INTELLIGENCE_ENABLED',
  coach: 'FANTASY_OS_SPORTS_DATA_COACH_ENABLED',
  // Phase 5E-h — operator observability surface, independently reversible from customer intelligence.
  observability: 'FANTASY_OS_SPORTS_DATA_OBSERVABILITY_ENABLED',
}

/** True only when the subsystem gate is explicitly "true". Disabled (default) preserves existing behavior. */
export function isSportsDataEnabled(subsystem: SportsDataSubsystem): boolean {
  return process.env[ENV_KEY[subsystem]] === 'true'
}

/** Secret-safe diagnostics: gate names + enabled booleans only, never values. */
export function sportsDataGateDiagnostics(): Array<{ subsystem: SportsDataSubsystem; envKey: string; enabled: boolean }> {
  return (Object.keys(ENV_KEY) as SportsDataSubsystem[]).map((s) => ({ subsystem: s, envKey: ENV_KEY[s], enabled: isSportsDataEnabled(s) }))
}
