/**
 * Fantasy OS Phase 5D — capability routing matrix (Stop-gate 2).
 *
 * Which VERIFIED provider owns each (sport, capability). A capability cannot enter the live runtime until its
 * provider is at least minimally verified. Sleeper is verified only for its native league scopes; games /
 * schedules / injuries / availability / statistics / projections / weather need a SEPARATE verified provider
 * (all currently `configured_not_verified`) and must NOT be pretended to come from Sleeper.
 */
import type { SportsDataCapability } from './capabilities'

export type CapabilityVerification = 'verified' | 'configured_not_verified' | 'unsupported'

export type CapabilityRoute = {
  sport: string
  capability: SportsDataCapability
  primaryProvider: string
  fallbackProviders: string[]
  verificationStatus: CapabilityVerification
  refreshCadenceMinutes: number
  maximumStalenessMinutes: number
  limitations: string[]
}

export const CAPABILITY_ROUTES: CapabilityRoute[] = [
  // ── Sleeper-native, VERIFIED ──────────────────────────────────────────────────
  { sport: 'NFL', capability: 'players', primaryProvider: 'sleeper', fallbackProviders: [], verificationStatus: 'verified', refreshCadenceMinutes: 240, maximumStalenessMinutes: 1440, limitations: ['Directory is large — cache aggressively.'] },
  { sport: 'NFL', capability: 'rosters', primaryProvider: 'sleeper', fallbackProviders: [], verificationStatus: 'verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 60, limitations: ['League-scoped; requires a league id.'] },
  { sport: 'NFL', capability: 'transactions', primaryProvider: 'sleeper', fallbackProviders: [], verificationStatus: 'verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 60, limitations: ['Week-based endpoints; offseason week-0 not sampled by default.'] },
  { sport: 'NFL', capability: 'draft_data', primaryProvider: 'sleeper', fallbackProviders: [], verificationStatus: 'verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 120, limitations: ['Completed drafts are immutable — cache aggressively.'] },

  // ── Need a SEPARATE verified provider — NOT reliably from Sleeper ───────────────
  { sport: 'NFL', capability: 'schedules', primaryProvider: 'rolling_insights', fallbackProviders: ['api_sports', 'espn'], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 720, maximumStalenessMinutes: 1440, limitations: ['Required before Lineup lock can move beyond `unknown`. Not yet verified.'] },
  { sport: 'NFL', capability: 'games', primaryProvider: 'rolling_insights', fallbackProviders: ['api_sports', 'espn'], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 60, limitations: ['Live/final status needs a verified provider.'] },
  { sport: 'NFL', capability: 'live_scores', primaryProvider: 'rolling_insights', fallbackProviders: ['api_sports'], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 45, limitations: ['In-game only; not yet verified.'] },
  { sport: 'NFL', capability: 'injuries', primaryProvider: 'rolling_insights', fallbackProviders: ['api_sports'], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 60, limitations: ['Sleeper player.injury_status is coarse; a real injury feed is unverified.'] },
  { sport: 'NFL', capability: 'statistics', primaryProvider: 'rolling_insights', fallbackProviders: ['api_sports'], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 30, maximumStalenessMinutes: 60, limitations: ['Live vs final vs corrected must be preserved; not yet verified.'] },
  { sport: 'NFL', capability: 'projections', primaryProvider: 'rolling_insights', fallbackProviders: [], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 720, maximumStalenessMinutes: 1440, limitations: ['Must stay separate from actual statistics; not yet verified.'] },
  { sport: 'NFL', capability: 'weather', primaryProvider: 'openweathermap', fallbackProviders: [], verificationStatus: 'configured_not_verified', refreshCadenceMinutes: 60, maximumStalenessMinutes: 180, limitations: ['Game weather only; not yet verified.'] },
]

export function routeFor(sport: string, capability: SportsDataCapability): CapabilityRoute | undefined {
  return CAPABILITY_ROUTES.find((r) => r.sport.toUpperCase() === sport.toUpperCase() && r.capability === capability)
}

/** A capability may only enter the live runtime when its route is verified. */
export function isLiveEligible(sport: string, capability: SportsDataCapability): boolean {
  return routeFor(sport, capability)?.verificationStatus === 'verified'
}
