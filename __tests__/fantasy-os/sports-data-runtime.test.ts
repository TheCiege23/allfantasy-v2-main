import { describe, it, expect } from 'vitest'
import { recordContentHash, snapshotChecksum, canonicalKeyFor } from '@/lib/sports-data-gateway/runtime/checksum'
import { canCertify, countSnapshot, type SnapshotDraft, type SnapshotRecordDraft } from '@/lib/sports-data-gateway/runtime/snapshot'
import { diffSnapshot, deterministicEventId } from '@/lib/sports-data-gateway/runtime/events'

const rec = (over: Partial<SnapshotRecordDraft> = {}): SnapshotRecordDraft => ({
  canonicalKey: 'canon-1', resolutionStatus: 'resolved', contentHash: 'h1', record: { canonicalPlayerId: 'canon-1' }, schemaValid: true, ...over,
})
const draft = (over: Partial<SnapshotDraft> = {}): SnapshotDraft => ({
  snapshotId: 's1', version: 'v1', sport: 'NFL', capability: 'players', provider: 'sleeper', generatedAt: '2026-07-11T00:00:00Z',
  sourceUpdatedAt: null, records: [rec()], rejectedCount: 0, runPartial: false, scopeComplete: true, previousSnapshotId: null, limitations: [], ...over,
})

describe('runtime checksum', () => {
  it('record content hash ignores volatile provenance fields', () => {
    const a = recordContentHash({ x: 1, source: { primaryProvider: 'p', fetchedAt: 'T1', snapshotVersion: 'v1' } })
    const b = recordContentHash({ x: 1, source: { primaryProvider: 'p', fetchedAt: 'T2', snapshotVersion: 'v2' } })
    expect(a).toBe(b) // same fact, different fetch time → same hash (basis for no-change suppression)
    const c = recordContentHash({ x: 2, source: { primaryProvider: 'p', fetchedAt: 'T1' } })
    expect(a).not.toBe(c)
  })
  it('snapshot checksum is deterministic and order-insensitive', () => {
    const s1 = snapshotChecksum([{ canonicalKey: 'a', contentHash: '1' }, { canonicalKey: 'b', contentHash: '2' }])
    const s2 = snapshotChecksum([{ canonicalKey: 'b', contentHash: '2' }, { canonicalKey: 'a', contentHash: '1' }])
    expect(s1).toBe(s2)
  })
  it('canonicalKey prefers resolved id, falls back to provider id for quarantined', () => {
    expect(canonicalKeyFor({ canonicalPlayerId: 'canon-9', providerIds: { sleeper: '9' }, source: { primaryProvider: 'sleeper', providerRecordId: '9' } as never })).toBe('canon-9')
    expect(canonicalKeyFor({ canonicalPlayerId: 'unresolved:sleeper:9', providerIds: { sleeper: '9' }, source: { primaryProvider: 'sleeper', providerRecordId: '9' } as never })).toBe('unresolved:sleeper:9')
  })
})

describe('snapshot certification', () => {
  it('certifies a clean snapshot with a deterministic checksum + counts', () => {
    const d = canCertify(draft())
    expect(d.certifiable).toBe(true)
    if (d.certifiable) {
      expect(d.checksum).toBeTruthy()
      expect(d.counts).toMatchObject({ recordCount: 1, resolvedCount: 1, rejectedCount: 0 })
    }
  })
  it('rejects a partial run', () => {
    const d = canCertify(draft({ runPartial: true }))
    expect(d.certifiable).toBe(false)
    if (!d.certifiable) expect(d.reasons).toContain('run is partial')
  })
  it('rejects an incomplete scope', () => {
    expect(canCertify(draft({ scopeComplete: false })).certifiable).toBe(false)
  })
  it('rejects a schema-invalid record', () => {
    expect(canCertify(draft({ records: [rec({ schemaValid: false })] })).certifiable).toBe(false)
  })
  it('rejects unexplained rejects (rejectedCount without limitations)', () => {
    const d = canCertify(draft({ rejectedCount: 2, limitations: [] }))
    expect(d.certifiable).toBe(false)
    if (!d.certifiable) expect(d.reasons).toContain('unexplained rejects (no limitations recorded)')
  })
  it('counts resolution outcomes', () => {
    const c = countSnapshot(draft({ records: [rec(), rec({ canonicalKey: 'c2', resolutionStatus: 'ambiguous' }), rec({ canonicalKey: 'c3', resolutionStatus: 'unresolved' })] }))
    expect(c).toMatchObject({ recordCount: 3, resolvedCount: 1, ambiguousCount: 1, unresolvedCount: 1 })
  })
})

describe('incremental events (dedup + no-change suppression)', () => {
  const records: SnapshotRecordDraft[] = [rec({ canonicalKey: 'a', contentHash: 'h-a' }), rec({ canonicalKey: 'b', contentHash: 'h-b' })]
  it('emits events for added records (no previous)', () => {
    const d = diffSnapshot(records, new Map(), { eventType: 'player_status_changed', sport: 'NFL', snapshotVersion: 'v1' })
    expect(d.added).toBe(2)
    expect(d.events).toHaveLength(2)
  })
  it('suppresses unchanged records (no event)', () => {
    const prev = new Map([['a', 'h-a'], ['b', 'h-b']])
    const d = diffSnapshot(records, prev, { eventType: 'player_status_changed', sport: 'NFL', snapshotVersion: 'v1' })
    expect(d.unchangedSuppressed).toBe(2)
    expect(d.events).toHaveLength(0)
  })
  it('emits an event only for the changed record', () => {
    const prev = new Map([['a', 'h-a'], ['b', 'OLD']])
    const d = diffSnapshot(records, prev, { eventType: 'player_status_changed', sport: 'NFL', snapshotVersion: 'v1' })
    expect(d.changed).toBe(1)
    expect(d.events).toHaveLength(1)
    expect(d.events[0].entityId).toBe('b')
  })
  it('event id is deterministic (idempotent inserts)', () => {
    expect(deterministicEventId('t', 'e', 'v', 'h')).toBe(deterministicEventId('t', 'e', 'v', 'h'))
    expect(deterministicEventId('t', 'e', 'v', 'h')).not.toBe(deterministicEventId('t', 'e', 'v', 'h2'))
  })
})
