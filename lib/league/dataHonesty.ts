/**
 * Shared honesty primitives for league UI surfaces (Honesty Pack 1A).
 *
 * Born from five audited fabrication sites: hash-derived "projections" rendered as real,
 * a league-health score computed from team-slot fill, mock IDP standings, an always-green
 * checklist, and "Live from …" labels over placeholder data. These utilities make the
 * honest state the easy state: missing data renders as missing, never as a plausible number.
 */

export type ProjectionAvailability =
  | {
      state: 'available'
      value: number
      source: 'provider' | 'allfantasy-derived'
      updatedAt?: string | null
    }
  | {
      state: 'unavailable'
      value: null
      source: null
      reason: 'provider_missing' | 'not_supported' | 'not_synced' | 'unknown'
    }

/**
 * Resolve what a projection cell may honestly display. A real provider value wins; an
 * explicitly-approved derived value is allowed WITH source labeling; anything else is
 * unavailable. Never substitutes a baseline. A mathematical zero is a real value.
 */
export function resolveProjectionAvailability(input: {
  providerProjection?: number | null
  derivedProjection?: number | null
  derivedProjectionApproved?: boolean
  providerSynced?: boolean
}): ProjectionAvailability {
  if (typeof input.providerProjection === 'number' && Number.isFinite(input.providerProjection)) {
    return { state: 'available', value: input.providerProjection, source: 'provider' }
  }
  if (
    input.derivedProjectionApproved &&
    typeof input.derivedProjection === 'number' &&
    Number.isFinite(input.derivedProjection)
  ) {
    return { state: 'available', value: input.derivedProjection, source: 'allfantasy-derived' }
  }
  return {
    state: 'unavailable',
    value: null,
    source: null,
    reason: input.providerSynced === false ? 'not_synced' : 'provider_missing',
  }
}

// League Pulse sufficiency intentionally lives in ONE place: buildLeagueHomePulse
// (lib/decision-os/league-pulse.ts) returns an explicit insufficient-data pulse; the UI
// renders that state instead of running a second predicate that could disagree.

export type DataFreshness = 'live' | 'recent' | 'stale' | 'unavailable' | 'mixed'

/** "Live from X" may only be claimed for genuinely live data; everything else says what it is. */
export function getSourceLabel(input: { sourceName?: string | null; freshness: DataFreshness }): string {
  const source = input.sourceName ?? 'source'
  switch (input.freshness) {
    case 'live':
      return `Live from ${source}`
    case 'recent':
      return `Synced from ${source}`
    case 'stale':
      return `Previously synced from ${source}`
    case 'mixed':
      return 'Combined league data'
    case 'unavailable':
    default:
      return 'Data unavailable'
  }
}
