/**
 * Cross-provider fallback priority by **data domain** and sport.
 * Tier ordering is enforced by walking `getFallbackProvidersForDomain` first→last in merge helpers.
 * Lower tiers must not overwrite non-empty higher-tier fields unless metadata marks the current value stale/low-confidence.
 */

import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type ProviderName =
  | 'rolling_insights'
  | 'thesportsdb'
  | 'clearsports'
  | 'sleeper'
  | 'allfantasy_internal'

export type DataDomain =
  | 'player_profile'
  | 'player_images'
  | 'team_profile'
  | 'team_logos'
  | 'player_stats'
  | 'team_stats'
  | 'projections'
  | 'live_scoring'
  | 'injuries'
  | 'schedules'
  | 'games'
  | 'adp'
  | 'ai_adp'
  | 'rookie_experience'
  | 'waiver_value'
  | 'trade_value'
  | 'roster_context'
  | 'lineup_context'

/** Ordered fallback chains — earlier = higher priority when filling gaps. */
function chainForDomain(domain: DataDomain, sport: LeagueSport): ProviderName[] {
  const isNfl = sport === 'NFL'

  switch (domain) {
    case 'player_profile':
      return ['rolling_insights', 'thesportsdb', 'clearsports', 'sleeper', 'allfantasy_internal']
    case 'player_images':
      return ['rolling_insights', 'thesportsdb', 'sleeper', 'clearsports', 'allfantasy_internal']
    case 'team_profile':
      return ['rolling_insights', 'thesportsdb', 'clearsports', 'allfantasy_internal']
    case 'team_logos':
      return ['rolling_insights', 'thesportsdb', 'clearsports', 'allfantasy_internal']
    case 'player_stats':
    case 'team_stats':
      return ['rolling_insights', 'clearsports', 'thesportsdb', 'allfantasy_internal']
    case 'projections':
      return ['rolling_insights', 'clearsports', 'thesportsdb', 'allfantasy_internal']
    case 'live_scoring':
    case 'injuries':
      return isNfl
        ? ['rolling_insights', 'clearsports', 'thesportsdb', 'allfantasy_internal']
        : ['rolling_insights', 'clearsports', 'thesportsdb', 'allfantasy_internal']
    case 'schedules':
    case 'games':
      return ['rolling_insights', 'thesportsdb', 'clearsports', 'allfantasy_internal']
    case 'adp':
      return ['allfantasy_internal', 'sleeper', 'rolling_insights', 'thesportsdb', 'clearsports']
    case 'ai_adp':
      return ['allfantasy_internal']
    case 'rookie_experience':
      return isNfl
        ? ['rolling_insights', 'thesportsdb', 'clearsports', 'sleeper', 'allfantasy_internal']
        : ['rolling_insights', 'thesportsdb', 'clearsports', 'allfantasy_internal']
    case 'waiver_value':
    case 'trade_value':
    case 'roster_context':
      return ['allfantasy_internal']
    case 'lineup_context':
      return ['allfantasy_internal', 'rolling_insights', 'clearsports', 'thesportsdb', 'sleeper']
    default:
      return ['rolling_insights', 'thesportsdb', 'clearsports', 'allfantasy_internal']
  }
}

export function getFallbackProvidersForDomain(domain: DataDomain, sport: string): ProviderName[] {
  return [...chainForDomain(domain, normalizeToSupportedSport(sport))]
}

export function getPrimaryProviderForDomain(domain: DataDomain, sport: string): ProviderName {
  const c = chainForDomain(domain, normalizeToSupportedSport(sport))
  return c[0] ?? 'rolling_insights'
}

export function isFantasyInternalDomain(domain: DataDomain): boolean {
  return (
    domain === 'adp' ||
    domain === 'ai_adp' ||
    domain === 'waiver_value' ||
    domain === 'trade_value' ||
    domain === 'roster_context' ||
    domain === 'lineup_context'
  )
}

export function isProviderAllowedForDomain(provider: ProviderName, domain: DataDomain, sport: string): boolean {
  return getFallbackProvidersForDomain(domain, sport).includes(provider)
}

export type GapFillMetadata = {
  staleCurrent?: boolean
  lowConfidenceCurrent?: boolean
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return !Number.isFinite(v)
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

/**
 * Whether `candidateValue` may replace `currentValue` for inline merge decisions.
 * Tier walk elsewhere prefers higher priority first — this guards explicit replacements.
 */
export function shouldProviderFillGap(
  _provider: ProviderName,
  _domain: DataDomain,
  currentValue: unknown,
  candidateValue: unknown,
  metadata?: GapFillMetadata,
): boolean {
  if (isEmpty(candidateValue)) return false
  if (isEmpty(currentValue)) return true
  return Boolean(metadata?.staleCurrent || metadata?.lowConfidenceCurrent)
}

export type MergeFieldPolicy = 'prefer_higher_tier' | 'never_overwrite_nonempty'

export function mergeProviderField<T>(
  current: T | null | undefined,
  candidate: T | null | undefined,
  policy: MergeFieldPolicy,
): T | null | undefined {
  if (policy === 'never_overwrite_nonempty') {
    if (!isEmpty(current)) return current
    return isEmpty(candidate) ? current : candidate
  }
  return isEmpty(current) ? (isEmpty(candidate) ? current : candidate) : current
}

export function providerTierIndex(provider: ProviderName, domain: DataDomain, sport: string): number {
  const c = getFallbackProvidersForDomain(domain, sport)
  const i = c.indexOf(provider)
  return i < 0 ? 999 : i
}

/** True if `a` is strictly higher priority (lower index) than `b` for this domain. */
export function isHigherTierThan(
  a: ProviderName,
  b: ProviderName,
  domain: DataDomain,
  sport: string,
): boolean {
  return providerTierIndex(a, domain, sport) < providerTierIndex(b, domain, sport)
}
