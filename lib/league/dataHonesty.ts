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

/**
 * League Pulse may render ONLY when a real qualifying signal exists. The card previously
 * scored ~88% "Healthy" for any filled imported league purely from team-slot fill — a
 * fabricated read on a league we knew nothing about.
 */
export function hasLeaguePulseData(input: {
  activityCount?: number | null
  transactionCount?: number | null
  signalCount?: number | null
  managerDnaPresent?: boolean
  lastActivityAt?: string | null
}): boolean {
  return Boolean(
    (input.activityCount ?? 0) > 0 ||
      (input.transactionCount ?? 0) > 0 ||
      (input.signalCount ?? 0) > 0 ||
      input.managerDnaPresent ||
      input.lastActivityAt
  )
}

export type ChecklistSignal = {
  id: string
  label: string
  state: 'complete' | 'incomplete' | 'unknown'
  explanation?: string
}

/** A checklist item may claim completion ONLY from a real boolean. Null/undefined = unknown. */
export function resolveChecklistSignal(label: string, value: boolean | null | undefined): ChecklistSignal {
  return {
    id: label.toLowerCase().replace(/\s+/g, '-'),
    label,
    state: value === true ? 'complete' : value === false ? 'incomplete' : 'unknown',
  }
}

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
