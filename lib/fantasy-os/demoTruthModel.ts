/**
 * Fantasy OS Suite — Phase V8.5: the Demo Truth Model.
 *
 * ONE shared, customer-facing vocabulary for how data is sourced and how fresh it is — so the executive
 * UI never confuses the viewer about what they are looking at. The three load-bearing invariants:
 *   1. presentation preview is NEVER labeled live (`isLive` is true only for `live-connected`);
 *   2. unavailable evidence is NEVER rendered as zero (it has its own state + copy);
 *   3. engineering smoke data is NEVER presented as the user's own portfolio.
 * Provider-neutral: no provider names, no raw ids. White-label-safe: tones map to semantic status tokens.
 */

export type DemoDataState =
  | 'live-connected' // the user's real, authorized, currently-synced data
  | 'presentation-preview' // presentation-safe preview data, explicitly labeled
  | 'engineering-smoke' // internal single-account validation data — never shown as a user's portfolio
  | 'partial-evidence' // real but incomplete (partial history / missing categories)
  | 'stale-evidence' // real but not recently synced
  | 'unavailable-evidence' // a contract the provider/corpus does not expose — NOT zero
  | 'empty-healthy' // a real, complete result that is legitimately empty (no action required)
  | 'sync-failure' // the last synchronization attempt failed

export type DemoStateTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger'

export interface DemoStateDescriptor {
  state: DemoDataState
  /** Short customer-facing label — the single canonical term for this state. */
  label: string
  /** One-line customer-facing description. Provider-neutral, evidence-based. */
  description: string
  tone: DemoStateTone
  /** True ONLY for real, current, connected data. Preview/smoke/unavailable are never live. */
  isLive: boolean
}

/** The canonical, single-source-of-truth copy for every demo/data state. */
export const DEMO_STATE_DESCRIPTORS: Record<DemoDataState, DemoStateDescriptor> = {
  'live-connected': {
    state: 'live-connected', label: 'Live', tone: 'success', isLive: true,
    description: 'Your connected, up-to-date data.',
  },
  'presentation-preview': {
    state: 'presentation-preview', label: 'Preview', tone: 'info', isLive: false,
    description: 'Presentation preview data — not your connected leagues.',
  },
  'engineering-smoke': {
    state: 'engineering-smoke', label: 'Sample (internal)', tone: 'warning', isLive: false,
    description: 'Internal validation sample — not customer data.',
  },
  'partial-evidence': {
    state: 'partial-evidence', label: 'Partial history', tone: 'warning', isLive: false,
    description: 'Some evidence is not yet imported for this view.',
  },
  'stale-evidence': {
    state: 'stale-evidence', label: 'Needs sync', tone: 'warning', isLive: false,
    description: 'This data has not been synchronized recently.',
  },
  'unavailable-evidence': {
    state: 'unavailable-evidence', label: 'Data unavailable', tone: 'neutral', isLive: false,
    description: 'This evidence is not available from the connected source.',
  },
  'empty-healthy': {
    state: 'empty-healthy', label: 'No action required', tone: 'success', isLive: false,
    description: 'Everything looks healthy — nothing needs attention right now.',
  },
  'sync-failure': {
    state: 'sync-failure', label: 'Sync failed', tone: 'danger', isLive: false,
    description: 'The last synchronization attempt did not complete.',
  },
}

export function describeDemoState(state: DemoDataState): DemoStateDescriptor {
  return DEMO_STATE_DESCRIPTORS[state]
}

/** Default staleness threshold: data older than this reads as "needs sync". */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/** True when a real snapshot timestamp is older than the staleness threshold. */
export function isStale(generatedAtIso: string | null | undefined, now: Date = new Date(), thresholdMs = STALE_AFTER_MS): boolean {
  if (!generatedAtIso) return false
  const t = new Date(generatedAtIso).getTime()
  if (!Number.isFinite(t)) return false
  return now.getTime() - t > thresholdMs
}

/**
 * Human-readable freshness label from a real snapshot timestamp. Returns null when there is no real
 * timestamp — the UI must then say "freshness unavailable", never invent one.
 */
export function formatFreshness(generatedAtIso: string | null | undefined, now: Date = new Date()): string | null {
  if (!generatedAtIso) return null
  const t = new Date(generatedAtIso).getTime()
  if (!Number.isFinite(t)) return null
  const deltaMs = Math.max(0, now.getTime() - t)
  const min = Math.floor(deltaMs / 60000)
  if (min < 1) return 'Updated just now'
  if (min < 60) return `Updated ${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `Updated ${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  return `Updated ${day} day${day === 1 ? '' : 's'} ago`
}

/**
 * Resolve the top-level demo state for an entry surface from truthful inputs. Deliberately conservative:
 * without authentication + connected leagues + a real snapshot, it is never `live-connected`.
 */
export function resolveEntryDemoState(input: {
  isAuthenticated: boolean
  hasConnectedLeagues: boolean
  snapshotGeneratedAt?: string | null
  syncFailed?: boolean
  now?: Date
}): DemoDataState {
  if (input.syncFailed) return 'sync-failure'
  if (!input.isAuthenticated || !input.hasConnectedLeagues) return 'presentation-preview'
  if (input.snapshotGeneratedAt && isStale(input.snapshotGeneratedAt, input.now)) return 'stale-evidence'
  return 'live-connected'
}
