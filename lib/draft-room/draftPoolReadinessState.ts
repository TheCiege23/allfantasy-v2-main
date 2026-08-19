/**
 * Pure draft-pool readiness derivation + malformed/stale/missing diagnosis.
 *
 * Phase 3 (NFL redraft draft-room smoke coverage). Two responsibilities, both
 * pure so they unit-test without React, Prisma, or a live draft server:
 *
 *  1. resolveDraftPoolLoadingState — the gate behind the draft room loading
 *     copy. Guarantees "Preparing player pool..." shows ONLY while the pool is
 *     genuinely not ready and no entries have arrived; otherwise the generic
 *     "Loading player pool..." copy is used. Also derives whether starting the
 *     draft must be blocked because the pool is empty/not ready.
 *
 *  2. diagnoseDraftPoolPayload — clear, structured failure output when a draft
 *     pool payload is missing, empty, malformed, or stale. The draft room and
 *     smoke tooling use this so a broken pool fails loudly instead of silently
 *     rendering an empty board.
 *
 * Keep this module dependency-free (types only) so it stays importable from both
 * the 'use client' draft room component and Node-side smoke scripts/tests.
 */

export type DraftPoolLoadingInputs = {
  /** Normalized pool payload once fetched, or null while still loading. */
  draftPool: { entries: unknown[] } | null
  /** True while the pool fetch is in flight. */
  poolFetching: boolean
  /** Server/cache readiness signal; null until the first readiness read. */
  poolReadiness: { ready: boolean } | null
  /** Whether the viewer is allowed to start the draft (commissioner gate). */
  canStart: boolean
}

export type DraftPoolLoadingState = {
  /** Pool is still loading and nothing has arrived yet. */
  poolLoading: boolean
  /** Show the "Preparing player pool..." copy specifically (cold prewarm). */
  showPreparingPool: boolean
  /** Resolved user-facing loading copy. */
  poolLoadingMessage: string
  /** Start-draft must be blocked because the pool is not usable yet. */
  startDraftBlocked: boolean
}

export const PREPARING_POOL_MESSAGE = 'Preparing player pool...'
export const LOADING_POOL_MESSAGE = 'Loading player pool...'

/**
 * Mirrors the gating that previously lived inline in DraftRoomPageClient. The
 * "Preparing player pool..." copy is shown only when no pool has arrived AND the
 * readiness signal explicitly reports not-ready (cold cache / background
 * prewarm). Once entries are present, neither loading message is shown.
 */
export function resolveDraftPoolLoadingState(input: DraftPoolLoadingInputs): DraftPoolLoadingState {
  const draftPoolPresent = input.draftPool !== null
  const entryCount = draftPoolPresent ? input.draftPool!.entries.length : 0
  const readyIsFalse = input.poolReadiness?.ready === false

  const poolLoading = input.poolFetching && !draftPoolPresent
  const showPreparingPool = !draftPoolPresent && readyIsFalse
  const poolLoadingMessage = showPreparingPool ? PREPARING_POOL_MESSAGE : LOADING_POOL_MESSAGE
  const startDraftBlocked =
    input.canStart && (readyIsFalse || input.poolFetching || !draftPoolPresent || entryCount === 0)

  return { poolLoading, showPreparingPool, poolLoadingMessage, startDraftBlocked }
}

export type DraftPoolDiagnosisReason = 'ok' | 'missing' | 'empty' | 'malformed' | 'stale'
export type DraftPoolDiagnosisSeverity = 'ok' | 'warning' | 'blocking'

export type DraftPoolDiagnosis = {
  ok: boolean
  severity: DraftPoolDiagnosisSeverity
  reason: DraftPoolDiagnosisReason
  /** Human-readable failure output suitable for logs and dev banners. */
  message: string
  entryCount: number
}

type ReadinessForDiagnosis = {
  ready?: boolean
  source?: string | null
  syncedAt?: string | null
} | null

export type DiagnoseDraftPoolOptions = {
  readiness?: ReadinessForDiagnosis
  /** Max acceptable pool age before it's flagged stale. Default: 24h. */
  maxAgeMs?: number
  /** Injectable clock for deterministic tests. */
  now?: number
}

const DEFAULT_MAX_POOL_AGE_MS = 24 * 60 * 60 * 1000

function isNamedEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as {
    name?: unknown
    playerName?: unknown
    display?: { displayName?: unknown; playerId?: unknown } | null
    playerId?: unknown
  }
  const hasName =
    (typeof e.name === 'string' && e.name.trim().length > 0) ||
    (typeof e.playerName === 'string' && e.playerName.trim().length > 0) ||
    (typeof e.display?.displayName === 'string' && (e.display.displayName as string).trim().length > 0)
  const hasId =
    (typeof e.playerId === 'string' && e.playerId.trim().length > 0) ||
    (typeof e.display?.playerId === 'string' && (e.display.playerId as string).trim().length > 0)
  return hasName || hasId
}

/**
 * Returns clear, structured failure output when a draft pool payload is
 * missing, empty, malformed, or stale. Blocking severity means the board must
 * not be treated as ready; warning (stale) means usable-but-flag.
 */
export function diagnoseDraftPoolPayload(
  payload: unknown,
  options: DiagnoseDraftPoolOptions = {},
): DraftPoolDiagnosis {
  if (payload === null || payload === undefined) {
    return {
      ok: false,
      severity: 'blocking',
      reason: 'missing',
      message: 'Draft player pool is missing — pool payload failed to load.',
      entryCount: 0,
    }
  }

  if (typeof payload !== 'object') {
    return {
      ok: false,
      severity: 'blocking',
      reason: 'malformed',
      message: `Draft player pool is malformed — expected an object payload, received ${typeof payload}.`,
      entryCount: 0,
    }
  }

  const entries = (payload as { entries?: unknown }).entries
  if (!Array.isArray(entries)) {
    return {
      ok: false,
      severity: 'blocking',
      reason: 'malformed',
      message: 'Draft player pool is malformed — `entries` is not an array.',
      entryCount: 0,
    }
  }

  if (entries.length === 0) {
    return {
      ok: false,
      severity: 'blocking',
      reason: 'empty',
      message: 'Draft player pool is empty — 0 players available to draft.',
      entryCount: 0,
    }
  }

  const malformedCount = entries.filter((entry) => !isNamedEntry(entry)).length
  if (malformedCount > 0) {
    return {
      ok: false,
      severity: 'blocking',
      reason: 'malformed',
      message: `Draft player pool is malformed — ${malformedCount}/${entries.length} entries are missing a player name and id.`,
      entryCount: entries.length,
    }
  }

  const syncedAt = options.readiness?.syncedAt ?? null
  if (typeof syncedAt === 'string' && syncedAt.length > 0) {
    const syncedMs = Date.parse(syncedAt)
    if (Number.isFinite(syncedMs)) {
      const now = options.now ?? Date.now()
      const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_POOL_AGE_MS
      const ageMs = now - syncedMs
      if (ageMs > maxAgeMs) {
        const ageHours = Math.round(ageMs / (60 * 60 * 1000))
        return {
          ok: false,
          severity: 'warning',
          reason: 'stale',
          message: `Draft player pool is stale — last synced ${ageHours}h ago (max ${Math.round(
            maxAgeMs / (60 * 60 * 1000),
          )}h).`,
          entryCount: entries.length,
        }
      }
    }
  }

  return {
    ok: true,
    severity: 'ok',
    reason: 'ok',
    message: `Draft player pool ready — ${entries.length} players available.`,
    entryCount: entries.length,
  }
}
