/**
 * Provider tier ordering — Rolling Insights primary for documented paid feeds;
 * Sleeper retains NFL years_exp rookie fallback + fantasy ecosystem ids.
 */

import type { LeagueSport } from '@prisma/client'

import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

/** @alias ProviderTierId — explicit vendor tier ids */
export type SportsDataProvider =
  | 'rolling_insights'
  | 'thesportsdb'
  | 'clearsports'
  | 'sleeper'
  | 'internal'

export type ProviderTierId = SportsDataProvider

export type ProviderField =
  | 'player_profile'
  | 'player_stats'
  | 'projections'
  | 'live_scoring'
  | 'injuries'
  | 'teams'
  | 'schedules'
  | 'depth_charts'
  | 'play_by_play'
  | 'rookie_years_exp'
  | 'fantasy_ids'
  | 'adp'
  | 'images'

const STANDARD_CHAIN_NO_SLEEPER_FIRST: readonly SportsDataProvider[] = [
  'rolling_insights',
  'thesportsdb',
  'clearsports',
  'internal',
] as const

const NFL_CHAIN: readonly SportsDataProvider[] = [
  'rolling_insights',
  'thesportsdb',
  'clearsports',
  'sleeper',
  'internal',
] as const

/** Normalize to Prisma `LeagueSport` for app consistency. */
export function normalizeProviderSport(sport: string): LeagueSport {
  return normalizeToSupportedSport(sport)
}

export function getProviderPriorityForSport(sport: string): SportsDataProvider[] {
  const s = normalizeToSupportedSport(sport) as SupportedSport
  if (s === 'NFL') return [...NFL_CHAIN]
  return [...STANDARD_CHAIN_NO_SLEEPER_FIRST]
}

export function getPrimaryProviderForSport(sport: string): SportsDataProvider {
  void normalizeToSupportedSport(sport)
  return 'rolling_insights'
}

export function isRollingInsightsPrimarySport(sport: string): boolean {
  void normalizeToSupportedSport(sport)
  return true
}

/**
 * Owns the logical field/domain for tier resolution (not necessarily exclusive).
 */
export function getProviderForField(sport: string, field: ProviderField | string): SportsDataProvider {
  const s = normalizeToSupportedSport(sport) as SupportedSport

  if (s === 'NFL') {
    if (field === 'rookie_years_exp') return 'sleeper'
    if (field === 'fantasy_ids') return 'sleeper'
    if (field === 'adp') return 'internal'
    if (field === 'images') return 'internal'
    if (
      field === 'player_profile' ||
      field === 'player_stats' ||
      field === 'projections' ||
      field === 'live_scoring' ||
      field === 'injuries' ||
      field === 'teams' ||
      field === 'schedules' ||
      field === 'depth_charts' ||
      field === 'play_by_play'
    ) {
      return 'rolling_insights'
    }
  }

  if (s === 'NCAAF') {
    if (field === 'rookie_years_exp') return 'internal'
    if (field === 'fantasy_ids') return 'internal'
    if (field === 'adp') return 'internal'
    if (field === 'images') return 'internal'
    if (
      field === 'player_profile' ||
      field === 'player_stats' ||
      field === 'projections' ||
      field === 'live_scoring' ||
      field === 'injuries' ||
      field === 'teams' ||
      field === 'schedules' ||
      field === 'depth_charts' ||
      field === 'play_by_play'
    ) {
      return 'rolling_insights'
    }
  }

  if (s === 'SOCCER') {
    if (field === 'rookie_years_exp') return 'internal'
    if (field === 'fantasy_ids') return 'internal'
    if (field === 'adp') return 'internal'
    if (field === 'images') return 'internal'
    if (
      field === 'player_profile' ||
      field === 'player_stats' ||
      field === 'projections' ||
      field === 'live_scoring' ||
      field === 'injuries' ||
      field === 'teams' ||
      field === 'schedules' ||
      field === 'depth_charts' ||
      field === 'play_by_play'
    ) {
      return 'rolling_insights'
    }
  }

  if (field === 'rookie_years_exp') return 'internal'
  if (field === 'fantasy_ids') return 'internal'
  if (field === 'adp') return 'internal'
  if (field === 'images') return 'internal'

  return 'rolling_insights'
}

export function isSleeperRookieFallbackForNfl(field: string): boolean {
  return field === 'rookie_years_exp'
}

/**
 * Ordered vendor chain for merging cached/imported rows (first hit wins per merge rules).
 * Does not replace field-specific logic in `resolvePlayerExperience` (e.g. ClearSports stats JSON
 * without experience keys must not imply rookie/veteran).
 */
export function getProviderFallbackChainForField(sport: string, field: ProviderField | string): SportsDataProvider[] {
  void field
  return [...getProviderPriorityForSport(sport)]
}
