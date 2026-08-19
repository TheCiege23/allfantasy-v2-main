/**
 * Fantasy OS Phase 5B — deterministic checksums for canonical records + snapshots.
 *
 * Content hashing strips VOLATILE provenance fields (fetchedAt, per-record snapshotVersion) so an unchanged
 * fact hashes identically across runs — the basis for no-change event suppression and idempotent snapshots.
 */
import crypto from 'node:crypto'
import type { CanonicalPlayer } from '../contracts'

/** Stable per-record content hash: canonical fields minus volatile provenance timestamps. */
export function recordContentHash(record: unknown): string {
  const stripped = stripVolatile(record)
  return sha256(stableStringify(stripped))
}

/** Deterministic snapshot checksum over the content hashes of all records, sorted by canonical key. */
export function snapshotChecksum(records: { canonicalKey: string; contentHash: string }[]): string {
  const sorted = [...records].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
  return sha256(sorted.map((r) => `${r.canonicalKey}:${r.contentHash}`).join('|'))
}

export function canonicalKeyFor(p: Pick<CanonicalPlayer, 'canonicalPlayerId' | 'providerIds' | 'source'>): string {
  // Prefer the resolved canonical id; fall back to the primary provider id for quarantined records.
  if (p.canonicalPlayerId && !p.canonicalPlayerId.startsWith('unresolved:')) return p.canonicalPlayerId
  const primary = p.source.primaryProvider
  return `unresolved:${primary}:${p.providerIds[primary] ?? p.source.providerRecordId}`
}

function stripVolatile(record: unknown): unknown {
  if (record == null || typeof record !== 'object') return record
  const clone: Record<string, unknown> = { ...(record as Record<string, unknown>) }
  if (clone.source && typeof clone.source === 'object') {
    const s = { ...(clone.source as Record<string, unknown>) }
    delete s.fetchedAt
    delete s.snapshotVersion
    delete s.sourceUpdatedAt
    clone.source = s
  }
  return clone
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}
