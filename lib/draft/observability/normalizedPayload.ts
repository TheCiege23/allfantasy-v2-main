import type { DraftHealthEventId } from './taxonomy'

/** Safe context shared across draft health logs (IDs only; no emails / names / prompts). */
export type DraftObservabilityBase = {
  leagueId?: string | null
  draftSessionId?: string | null
  draftType?: string | null
  /** High-level result: ok | skipped | error | degraded | … */
  outcome?: string | null
  /** Machine-oriented detail (codes, not free-form user text). */
  reason?: string | null
  durationMs?: number | null
  /** Numeric rollups only. */
  counts?: Record<string, number>
  /** Short error classification, e.g. Prisma code or invariant name. */
  errorClass?: string | null
  /** Correlates to DraftHealthEventId when mirrored on non-draft_health sources. */
  draftEvent?: DraftHealthEventId | null
}

const FORBIDDEN_KEYS = new Set([
  'email',
  'userEmail',
  'ownerEmail',
  'phone',
  'prompt',
  'rawPrompt',
  'payment',
  'card',
  'ssn',
  'password',
  'token',
  'authorization',
  // Human-readable names — never ship in draft_health payloads
  'playerName',
  'displayName',
  'ownerName',
  'userName',
  'teamName',
  'leagueName',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Drop known PII / display-name keys and nested objects' forbidden keys (shallow).
 * Prefer explicit fields via DraftObservabilityBase at call sites.
 */
export function sanitizeDraftObservabilityMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_KEYS.has(k)) continue
    if (isPlainObject(v)) {
      const inner: Record<string, unknown> = {}
      for (const [ik, iv] of Object.entries(v)) {
        if (!FORBIDDEN_KEYS.has(ik)) inner[ik] = iv
      }
      out[k] = inner
    } else {
      out[k] = v
    }
  }
  return out
}

export function buildNormalizedDraftHealthMeta(
  eventId: DraftHealthEventId,
  fields: DraftObservabilityBase & Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    draftEvent: eventId,
    ...(fields.leagueId != null && fields.leagueId !== '' ? { leagueId: fields.leagueId } : {}),
    ...(fields.draftSessionId != null && fields.draftSessionId !== ''
      ? { draftSessionId: fields.draftSessionId }
      : {}),
    ...(fields.draftType != null && fields.draftType !== '' ? { draftType: fields.draftType } : {}),
    ...(fields.outcome != null && fields.outcome !== '' ? { outcome: fields.outcome } : {}),
    ...(fields.reason != null && fields.reason !== '' ? { reason: fields.reason } : {}),
    ...(fields.durationMs != null && Number.isFinite(fields.durationMs)
      ? { durationMs: Math.max(0, Math.round(Number(fields.durationMs))) }
      : {}),
    ...(fields.counts && Object.keys(fields.counts).length > 0 ? { counts: { ...fields.counts } } : {}),
    ...(fields.errorClass != null && fields.errorClass !== '' ? { errorClass: fields.errorClass } : {}),
  }
  const rest = { ...fields }
  delete (rest as DraftObservabilityBase).leagueId
  delete (rest as DraftObservabilityBase).draftSessionId
  delete (rest as DraftObservabilityBase).draftType
  delete (rest as DraftObservabilityBase).outcome
  delete (rest as DraftObservabilityBase).reason
  delete (rest as DraftObservabilityBase).durationMs
  delete (rest as DraftObservabilityBase).counts
  delete (rest as DraftObservabilityBase).errorClass
  delete (rest as DraftObservabilityBase).draftEvent
  return sanitizeDraftObservabilityMeta({ ...base, ...rest })
}
