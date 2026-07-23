/**
 * Shared honesty model for the AF Legacy surface (Task 1 — Legacy Honesty Pack).
 *
 * One canonical vocabulary for "what do we actually know": every Legacy response and UI state
 * that previously collapsed failure/missing/processing into empty arrays or zeros maps onto
 * this instead. Client-safe (no server-only imports) — both route handlers and components use it.
 *
 * Related, deliberately NOT duplicated here:
 * - `components/unified-import-ui/import-health.ts` — visual tone grammar for import runs.
 * - `lib/ai-context-envelope/schema.ts` — the AI evidence envelope this model's confidence
 *   language aligns with.
 */

export type LegacyDataState =
  | 'available'
  | 'partial'
  | 'processing'
  | 'stale'
  | 'unavailable'
  | 'failed'
  | 'not_supported'
  | 'auth_required'
  | 'link_required'

export type LegacyDataConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface LegacyDataStatus {
  state: LegacyDataState
  confidence: LegacyDataConfidence
  source: 'sleeper' | 'allfantasy' | 'derived' | 'mixed'
  lastUpdatedAt: string | null
  reasonCode?: string
  message: string
  retryable: boolean
  externalActionRequired?: boolean
  externalActionLabel?: string
  externalActionUrl?: string
}

export interface LegacyResponseMeta {
  status: LegacyDataStatus
  requestId?: string
  warnings?: Array<{ code: string; message: string }>
}

export interface LegacyApiResponse<T> {
  data: T | null
  meta: LegacyResponseMeta
}

// ── Import display state ─────────────────────────────────────────────────────

export type LegacyImportDisplayState =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'stale'

/**
 * A completed import older than this renders as "complete but stale". Legacy data is
 * historical, but rosters/records drift — 24h matches the spec'd default; no other legacy
 * freshness policy exists in the repo (DataFreshnessBanner tiers measure per-import coverage,
 * not age).
 */
export const LEGACY_IMPORT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Canonical mapper from a `LegacyImportJob` record (status: queued|running|completed|failed,
 * plus the completeness columns) to what the user should be told. The DB has no 'partial'
 * status — partial is DERIVED from seasonsCompleted < totalSeasons, which is exactly the case
 * the old UI silently displayed as "complete".
 */
export function resolveLegacyImportDisplayState(input: {
  status?: string | null
  completedAt?: Date | string | null
  lastSyncedAt?: Date | string | null
  errorMessage?: string | null
  importedSeasonCount?: number | null
  expectedSeasonCount?: number | null
}): LegacyImportDisplayState {
  if (input.errorMessage || input.status === 'failed') {
    return 'failed'
  }
  if (input.status === 'queued') {
    return 'queued'
  }
  if (input.status === 'running' || input.status === 'processing') {
    return 'running'
  }

  const imported = input.importedSeasonCount ?? 0
  const expected = input.expectedSeasonCount ?? 0
  if (expected > 0 && imported > 0 && imported < expected) {
    return 'partial'
  }

  if (input.completedAt || input.status === 'completed' || input.status === 'complete') {
    const lastSyncedAt = input.lastSyncedAt
      ? new Date(input.lastSyncedAt)
      : input.completedAt
        ? new Date(input.completedAt)
        : null
    if (lastSyncedAt && Date.now() - lastSyncedAt.getTime() > LEGACY_IMPORT_STALE_AFTER_MS) {
      return 'stale'
    }
    return 'complete'
  }

  return 'not_started'
}

/** LegacyDataStatus for an import job, ready for a `meta` envelope or a LegacyDataNotice. */
export function importDisplayStateToStatus(
  displayState: LegacyImportDisplayState,
  input: {
    lastSyncedAt?: Date | string | null
    importedSeasonCount?: number | null
    expectedSeasonCount?: number | null
    errorMessage?: string | null
  } = {},
): LegacyDataStatus {
  const lastUpdatedAt = input.lastSyncedAt ? new Date(input.lastSyncedAt).toISOString() : null
  const imported = input.importedSeasonCount ?? null
  const expected = input.expectedSeasonCount ?? null

  switch (displayState) {
    case 'queued':
      return {
        state: 'processing',
        confidence: 'high',
        source: 'allfantasy',
        lastUpdatedAt,
        reasonCode: 'IMPORT_QUEUED',
        message: 'Your import is queued and will start shortly.',
        retryable: false,
      }
    case 'running':
      return {
        state: 'processing',
        confidence: 'high',
        source: 'allfantasy',
        lastUpdatedAt,
        reasonCode: 'IMPORT_RUNNING',
        message: 'Your Sleeper history is still importing.',
        retryable: false,
      }
    case 'partial':
      return {
        state: 'partial',
        confidence: 'medium',
        source: 'sleeper',
        lastUpdatedAt,
        reasonCode: 'IMPORT_PARTIAL',
        message:
          imported != null && expected != null
            ? `${imported} of ${expected} seasons imported. Some seasons could not be loaded from Sleeper.`
            : 'Some of your Sleeper history could not be imported.',
        retryable: true,
      }
    case 'stale':
      return {
        state: 'stale',
        confidence: 'medium',
        source: 'sleeper',
        lastUpdatedAt,
        reasonCode: 'IMPORT_STALE',
        message: 'This data was imported more than a day ago and may be outdated.',
        retryable: true,
      }
    case 'complete':
      return {
        state: 'available',
        confidence: 'high',
        source: 'sleeper',
        lastUpdatedAt,
        reasonCode: undefined,
        message: 'Imported Sleeper data is available.',
        retryable: false,
      }
    case 'failed':
      return {
        state: 'failed',
        confidence: 'high',
        source: 'allfantasy',
        lastUpdatedAt,
        reasonCode: 'IMPORT_FAILED',
        // Never leak raw provider errors — the job's errorMessage may contain provider
        // internals; keep the user copy generic and retryable.
        message: 'The import did not finish. You can try again.',
        retryable: true,
      }
    case 'not_started':
    default:
      return {
        state: 'unavailable',
        confidence: 'high',
        source: 'allfantasy',
        lastUpdatedAt: null,
        reasonCode: 'NO_IMPORT_STARTED',
        message: 'No Sleeper import has been started for this account.',
        retryable: true,
      }
  }
}

// ── Auth / linking errors ────────────────────────────────────────────────────

/**
 * Maps the auth/link failures the #288 identity gate can return (401 / 403
 * SLEEPER_USERNAME_MISMATCH / 409 HANDLE_CLAIMED / 409 SLEEPER_NOT_LINKED) into honest,
 * user-facing states. Never exposes raw provider errors or internals.
 */
export function mapLegacyAuthError(status: number, code?: string): LegacyDataStatus {
  if (status === 401) {
    return {
      state: 'auth_required',
      confidence: 'high',
      source: 'allfantasy',
      lastUpdatedAt: null,
      reasonCode: code ?? 'AUTH_REQUIRED',
      message: 'Sign in, or import your leagues as a guest, to access your league history.',
      retryable: false,
    }
  }

  if (status === 409 && code === 'HANDLE_CLAIMED') {
    return {
      state: 'link_required',
      confidence: 'high',
      source: 'allfantasy',
      lastUpdatedAt: null,
      reasonCode: code,
      message:
        'That Sleeper account is already linked to an AllFantasy login. Sign in to use it.',
      retryable: false,
    }
  }

  if (status === 409) {
    return {
      state: 'link_required',
      confidence: 'high',
      source: 'allfantasy',
      lastUpdatedAt: null,
      reasonCode: code ?? 'SLEEPER_NOT_LINKED',
      message: 'No Sleeper account is linked to this login. Import your leagues first.',
      retryable: false,
    }
  }

  if (status === 403) {
    return {
      state: 'link_required',
      confidence: 'high',
      source: 'allfantasy',
      lastUpdatedAt: null,
      reasonCode: code ?? 'IDENTITY_MISMATCH',
      message: 'You can only view data for the Sleeper account linked to your AllFantasy login.',
      retryable: false,
    }
  }

  return {
    state: 'failed',
    confidence: 'unknown',
    source: 'allfantasy',
    lastUpdatedAt: null,
    reasonCode: code ?? 'UNKNOWN_ERROR',
    message: 'We could not verify your Legacy access. Please try again.',
    retryable: true,
  }
}

// ── External platform honesty ────────────────────────────────────────────────

/**
 * AF is READ-ONLY for imported Sleeper leagues. Any action verb ("Set lineup", "Submit claim")
 * must resolve through this helper so external-platform leagues get advisory language and a
 * Sleeper deep-link instead of implying AF can write to Sleeper.
 */
export function getExternalPlatformAction(input: {
  platform: string
  action: string
  externalUrl?: string | null
}): { mode: 'native' | 'external'; label: string; external: boolean } {
  const isReadOnly = input.platform.trim().toLowerCase() !== 'allfantasy'

  if (!isReadOnly) {
    return { mode: 'native', label: input.action, external: false }
  }

  return {
    mode: 'external',
    label: input.externalUrl ? 'Open in Sleeper' : 'View recommendation',
    external: Boolean(input.externalUrl),
  }
}

// ── Intelligence evidence ────────────────────────────────────────────────────

export interface IntelligenceEvidence {
  confidence: LegacyDataConfidence
  dataCoveragePercent: number | null
  missingInputs: string[]
  basedOn: string[]
  disclaimer?: string
}

/**
 * Deterministic evidence summary for Legacy Intelligence outputs (rank preview, trade/waiver
 * analysis, manager psychology). The thresholds are conservative: thin history must SAY it is
 * thin, and speculative labels must read as observations ("limited evidence"), never facts.
 */
export function buildIntelligenceEvidence(input: {
  importedSeasonCount?: number | null
  expectedSeasonCount?: number | null
  matchupCount?: number | null
  tradeCount?: number | null
  rosterCount?: number | null
  basedOn: string[]
}): IntelligenceEvidence {
  const matchups = input.matchupCount ?? 0
  const trades = input.tradeCount ?? 0
  const rosters = input.rosterCount ?? 0
  const imported = input.importedSeasonCount ?? 0
  const expected = input.expectedSeasonCount ?? 0

  const missingInputs: string[] = []
  if (matchups < 20) missingInputs.push('historical matchups')
  if (trades < 5) missingInputs.push('historical trades')
  if (rosters < 1) missingInputs.push('roster data')

  const confidence: LegacyDataConfidence =
    rosters < 1 || matchups === 0
      ? 'low'
      : matchups >= 20 && trades >= 5
        ? 'high'
        : matchups >= 10
          ? 'medium'
          : 'low'

  return {
    confidence,
    dataCoveragePercent: expected > 0 ? Math.round((imported / expected) * 100) : null,
    missingInputs,
    basedOn: input.basedOn,
    disclaimer:
      confidence === 'low'
        ? 'This is based on limited historical evidence and may not be reliable yet.'
        : confidence === 'medium'
          ? 'This is based on a moderate amount of historical evidence.'
          : undefined,
  }
}
