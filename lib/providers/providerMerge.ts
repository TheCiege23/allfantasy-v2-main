/**
 * Field-level merge utilities — walk fallback chains from `providerFallbackPolicy`.
 * Does not call HTTP; callers supply values keyed by provider (from DB/cache/import jobs).
 */

import type {
  DataDomain,
  GapFillMetadata,
  ProviderName,
} from '@/lib/providers/providerFallbackPolicy'
import { getFallbackProvidersForDomain, getPrimaryProviderForDomain } from '@/lib/providers/providerFallbackPolicy'

export type MergedProviderField<T> = {
  value: T | null
  source: ProviderName | null
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  freshness: string | null
  fallbackUsed: boolean
  missingProviders: ProviderName[]
  rawSources: Partial<Record<ProviderName, unknown>>
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return !Number.isFinite(v)
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

export function mergeProviderValue<T>(
  fieldName: string,
  valuesByProvider: Partial<Record<ProviderName, T | null | undefined>>,
  domain: DataDomain,
  sport: string,
  options?: {
    staleByProvider?: Partial<Record<ProviderName, boolean>>
    gap?: GapFillMetadata
  },
): MergedProviderField<T> {
  void fieldName
  const chain = getFallbackProvidersForDomain(domain, sport)
  const primary = getPrimaryProviderForDomain(domain, sport)
  const rawSources: Partial<Record<ProviderName, unknown>> = { ...valuesByProvider }

  const missingProviders: ProviderName[] = []
  for (const p of chain) {
    if (isEmpty(valuesByProvider[p])) missingProviders.push(p)
  }

  let chosen: T | null = null
  let source: ProviderName | null = null

  for (const p of chain) {
    const raw = valuesByProvider[p]
    const stale = options?.staleByProvider?.[p]
    if (!isEmpty(raw) && !stale) {
      chosen = raw as T
      source = p
      break
    }
  }

  if (chosen == null && options?.gap?.staleCurrent) {
    for (const p of chain) {
      const raw = valuesByProvider[p]
      if (!isEmpty(raw)) {
        chosen = raw as T
        source = p
        break
      }
    }
  }

  const fallbackUsed = Boolean(source && source !== primary)

  const confidence: MergedProviderField<T>['confidence'] =
    source === primary ? 'high' : source ? 'medium' : 'unknown'

  return {
    value: chosen,
    source,
    confidence,
    freshness: null,
    fallbackUsed,
    missingProviders,
    rawSources,
  }
}

export function mergePlayerProfileFromProviders(
  inputs: Partial<Record<ProviderName, Record<string, unknown> | null | undefined>>,
  sport: string,
): MergedProviderField<Record<string, unknown>> {
  return mergeProviderValue('profile', inputs as Partial<Record<ProviderName, Record<string, unknown> | null>>, 'player_profile', sport)
}

export function mergePlayerStatsFromProviders(
  inputs: Partial<Record<ProviderName, unknown>>,
  sport: string,
): MergedProviderField<unknown> {
  return mergeProviderValue('stats', inputs, 'player_stats', sport)
}

export function mergePlayerInjuryFromProviders(
  inputs: Partial<Record<ProviderName, unknown>>,
  sport: string,
): MergedProviderField<unknown> {
  return mergeProviderValue('injury', inputs, 'injuries', sport)
}

export function mergePlayerImagesFromProviders(
  inputs: Partial<Record<ProviderName, string | null | undefined>>,
  sport: string,
): MergedProviderField<string> {
  return mergeProviderValue('imageUrl', inputs, 'player_images', sport)
}

export function mergeTeamProfileFromProviders(
  inputs: Partial<Record<ProviderName, Record<string, unknown> | null>>,
  sport: string,
): MergedProviderField<Record<string, unknown>> {
  return mergeProviderValue('team', inputs, 'team_profile', sport)
}

export function mergeScheduleGameFromProviders(
  inputs: Partial<Record<ProviderName, unknown>>,
  sport: string,
): MergedProviderField<unknown> {
  return mergeProviderValue('game', inputs, 'games', sport)
}

export function mergeAdpFromProviders(
  inputs: Partial<Record<ProviderName, number | null | undefined>>,
  sport: string,
): MergedProviderField<number> {
  return mergeProviderValue('adp', inputs, 'adp', sport)
}

export function mergeAiAdpFromProviders(
  inputs: Partial<Record<ProviderName, number | null | undefined>>,
  sport: string,
): MergedProviderField<number> {
  return mergeProviderValue('aiAdp', inputs, 'ai_adp', sport)
}

export function mergeExperienceFromProviders(
  inputs: Partial<Record<ProviderName, unknown>>,
  sport: string,
): MergedProviderField<unknown> {
  return mergeProviderValue('experience', inputs, 'rookie_experience', sport)
}
