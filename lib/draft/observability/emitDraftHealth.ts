import { logStructured, type LogLevel } from '@/lib/logging/structured'
import type { DraftHealthEventId } from './taxonomy'
import { DRAFT_HEALTH_SOURCE } from './taxonomy'
import { buildNormalizedDraftHealthMeta, type DraftObservabilityBase } from './normalizedPayload'

/**
 * Canonical draft observability line: `source=draft_health`, `event=<DraftHealthEventId>`.
 */
export function emitDraftHealth(
  level: LogLevel,
  eventId: DraftHealthEventId,
  fields: DraftObservabilityBase & Record<string, unknown> = {},
): void {
  const meta = buildNormalizedDraftHealthMeta(eventId, { ...fields, draftEvent: eventId })
  logStructured(level, DRAFT_HEALTH_SOURCE, eventId, meta)
}

/** Attach `draftEvent` for summarizers without switching `source` (legacy paths). */
export function withDraftHealthEvent<T extends Record<string, unknown>>(
  eventId: DraftHealthEventId,
  meta: T,
): T & { draftEvent: DraftHealthEventId } {
  return { ...meta, draftEvent: eventId }
}
