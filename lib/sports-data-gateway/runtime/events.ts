/**
 * Fantasy OS Phase 5B — incremental event diffing + deterministic ids (Part 2).
 *
 * Compares the new snapshot's records against the previous certified snapshot by content hash. Emits an event
 * ONLY for genuinely changed/new records (no event for unchanged data — no-change suppression). Event ids are
 * deterministic (same change ⇒ same id) so writes are idempotent.
 */
import crypto from 'node:crypto'
import type { SnapshotRecordDraft } from './snapshot'

export type DiffEvent = {
  eventId: string
  eventType: string
  entityId: string
  contentHash: string
  record: unknown
}

export type SnapshotDiff = { events: DiffEvent[]; changed: number; added: number; unchangedSuppressed: number }

/**
 * Diff by canonical key + content hash. `previous` maps canonicalKey → prior contentHash.
 * A record present before with the SAME contentHash produces no event (suppressed).
 */
export function diffSnapshot(
  records: SnapshotRecordDraft[],
  previous: Map<string, string>,
  opts: { eventType: string; sport: string; snapshotVersion: string },
): SnapshotDiff {
  let changed = 0
  let added = 0
  let unchangedSuppressed = 0
  const events: DiffEvent[] = []
  for (const r of records) {
    const prior = previous.get(r.canonicalKey)
    if (prior === r.contentHash) {
      unchangedSuppressed++
      continue
    }
    if (prior === undefined) added++
    else changed++
    events.push({
      eventId: deterministicEventId(opts.eventType, r.canonicalKey, opts.snapshotVersion, r.contentHash),
      eventType: opts.eventType,
      entityId: r.canonicalKey,
      contentHash: r.contentHash,
      record: r.record,
    })
  }
  return { events, changed, added, unchangedSuppressed }
}

/** Deterministic: same (type, entity, version, contentHash) ⇒ same id ⇒ idempotent insert / dedup. */
export function deterministicEventId(eventType: string, entityId: string, snapshotVersion: string, contentHash: string): string {
  return crypto.createHash('sha256').update(`${eventType}|${entityId}|${snapshotVersion}|${contentHash}`).digest('hex').slice(0, 32)
}
