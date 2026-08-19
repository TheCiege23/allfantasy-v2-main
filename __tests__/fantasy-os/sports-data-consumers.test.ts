import { describe, it, expect } from 'vitest'
import { computeLockStatus, canAutoSwitch, normalizeGameStatus } from '@/lib/sports-data-gateway/runtime/lock'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'
import { assembleLineupContext, assembleTradeContext, type CertifiedPlayerRecord } from '@/lib/sports-data-gateway/ports/runtimePorts'
import { summarizeObservability, type SyncRunRow } from '@/lib/sports-data-gateway/runtime/observability'
import type { CertifiedSnapshotMeta } from '@/lib/sports-data-gateway/runtime/store'

const d = (iso: string) => new Date(iso)
const player = (over: Partial<CertifiedPlayerRecord> = {}): CertifiedPlayerRecord => ({ canonicalPlayerId: 'canon:1', displayName: 'A B', sport: 'NFL', positions: ['QB'], teamId: 'KC', injuryStatus: null, active: true, ...over })
const start = '2026-11-15T18:00:00Z'
const fresh = buildCertifiedFreshness({ snapshotId: 's', version: 'v1', checksum: 'c', provider: 'sleeper', generatedAt: '2026-11-15T17:30:00Z', sourceUpdatedAt: null, recordCount: 1, resolvedCount: 1, ambiguousCount: 0, unresolvedCount: 0, rejectedCount: 0, limitations: [] }, d('2026-11-15T17:45:00Z'))

describe('lineup lock safety (Part 6)', () => {
  it('unlocked before start', () => expect(computeLockStatus({ scheduledStart: start, gameStatus: 'scheduled', now: d('2026-11-15T17:59:00Z') })).toBe('unlocked'))
  it('locked exactly at start', () => expect(computeLockStatus({ scheduledStart: start, gameStatus: 'scheduled', now: d(start) })).toBe('locked'))
  it('locked after start', () => expect(computeLockStatus({ scheduledStart: start, gameStatus: 'scheduled', now: d('2026-11-15T18:01:00Z') })).toBe('locked'))
  it('live game is locked', () => expect(computeLockStatus({ scheduledStart: start, gameStatus: 'in_progress', now: d('2026-11-15T17:00:00Z') })).toBe('locked'))
  it('final game is permanently locked', () => expect(computeLockStatus({ scheduledStart: start, gameStatus: 'final', now: d('2026-11-15T17:00:00Z') })).toBe('locked'))
  it('postponed/suspended games are unknown (fail closed)', () => {
    expect(computeLockStatus({ scheduledStart: start, gameStatus: 'postponed', now: d('2026-11-15T17:00:00Z') })).toBe('unknown')
    expect(computeLockStatus({ scheduledStart: start, gameStatus: 'suspended', now: d('2026-11-15T20:00:00Z') })).toBe('unknown')
  })
  it('missing schedule is unknown', () => expect(computeLockStatus({ scheduledStart: null, gameStatus: null, now: d(start) })).toBe('unknown'))
  it('injury status can never unlock (not a parameter) — lock ignores injury entirely', () => {
    // Same game/time → same lock regardless of any injury; the function has no injury input.
    expect(computeLockStatus({ scheduledStart: start, gameStatus: 'scheduled', now: d('2026-11-15T18:30:00Z') })).toBe('locked')
  })
  it('auto-switch fails closed unless confidently unlocked + fresh schedule', () => {
    expect(canAutoSwitch('unlocked', true)).toBe(true)
    expect(canAutoSwitch('unlocked', false)).toBe(false) // stale schedule
    expect(canAutoSwitch('unknown', true)).toBe(false)
    expect(canAutoSwitch('locked', true)).toBe(false)
  })
  it('normalizes provider statuses', () => {
    expect(normalizeGameStatus('Final')).toBe('final')
    expect(normalizeGameStatus('POSTPONED')).toBe('ambiguous')
    expect(normalizeGameStatus(null)).toBe('unknown')
  })
})

describe('lineup context assembly (fail-closed)', () => {
  it('missing game → lock unknown, projection null (never 0), carries freshness', () => {
    const c = assembleLineupContext({ player: player({ injuryStatus: 'Questionable' }), game: null, now: d(start), freshness: fresh })
    expect(c.lockStatus).toBe('unknown')
    expect(c.projectedFantasyPoints).toBeNull()
    expect(c.injuryStatus).toBe('Questionable')
    expect(c.dataContext.freshnessStatus).toBe('current')
  })
})

describe('trade context assembly (Part 4)', () => {
  it('resolved player → context with null (not 0) projection + empty stats', () => {
    const r = assembleTradeContext({ player: player(), game: null, freshness: fresh })
    expect(r.resolved).toBe(true)
    if (r.resolved) {
      expect(r.context.projection).toBeNull()
      expect(r.context.recentStats).toEqual({})
      expect(r.context.canonicalPlayerId).toBe('canon:1')
    }
  })
  it('unresolved identity → Insufficient Evidence', () => {
    const r = assembleTradeContext({ player: player({ canonicalPlayerId: 'unresolved:sleeper:9' }), game: null, freshness: fresh })
    expect(r.resolved).toBe(false)
    if (!r.resolved) expect(r.reason).toBe('Insufficient Evidence')
  })
})

describe('certified freshness (Stop-gate 2)', () => {
  const meta = (over: Partial<CertifiedSnapshotMeta> = {}): CertifiedSnapshotMeta => ({ snapshotId: 's', version: 'v1', checksum: 'c', provider: 'sleeper', generatedAt: '2026-11-15T17:00:00Z', sourceUpdatedAt: null, recordCount: 10, resolvedCount: 8, ambiguousCount: 0, unresolvedCount: 2, rejectedCount: 0, limitations: [], ...over })
  it('no snapshot → unavailable (no fabricated empty snapshot)', () => {
    const f = buildCertifiedFreshness(null, d('2026-11-15T17:30:00Z'))
    expect(f.freshnessStatus).toBe('unavailable')
    expect(f.snapshotVersions).toEqual([])
  })
  it('recent certified → current with version + provider visible', () => {
    const f = buildCertifiedFreshness(meta(), d('2026-11-15T17:30:00Z'))
    expect(f.freshnessStatus).toBe('current')
    expect(f.snapshotVersions).toEqual(['v1'])
    expect(f.sourceProviders).toEqual(['sleeper'])
  })
  it('stale certified → delayed (not hidden)', () => {
    const f = buildCertifiedFreshness(meta(), d('2026-11-15T19:00:00Z'))
    expect(f.freshnessStatus).toBe('delayed')
  })
  it('surfaces unresolved-identity limitation', () => {
    const f = buildCertifiedFreshness(meta(), d('2026-11-15T17:30:00Z'))
    expect(f.limitations.some((l) => /unresolved identities/i.test(l))).toBe(true)
  })
})

describe('observability summarizer (customer-safe status)', () => {
  const run = (over: Partial<SyncRunRow> = {}): SyncRunRow => ({ status: 'completed', startedAt: '2026-11-15T17:00:00Z', finishedAt: '2026-11-15T17:00:05Z', requestAttempts: 3, logicalRequests: 3, retries: 0, cacheHits: 1, permanentFailures: 0, advancedFreshness: true, ...over })
  it('current when snapshot recent + completed runs', () => {
    const s = summarizeObservability({ runs: [run()], latestCertifiedSnapshotAt: '2026-11-15T17:30:00Z', now: d('2026-11-15T17:45:00Z') })
    expect(s.customerStatus).toBe('Current')
    expect(s.requests.attempts).toBe(3)
  })
  it('unavailable when no certified snapshot', () => {
    expect(summarizeObservability({ runs: [], latestCertifiedSnapshotAt: null, now: d('2026-11-15T17:45:00Z') }).customerStatus).toBe('Unavailable')
  })
  it('delayed when snapshot is stale', () => {
    expect(summarizeObservability({ runs: [run()], latestCertifiedSnapshotAt: '2026-11-15T15:00:00Z', now: d('2026-11-15T17:45:00Z') }).customerStatus).toBe('Delayed')
  })
  it('computes failure rate', () => {
    const s = summarizeObservability({ runs: [run({ permanentFailures: 1, logicalRequests: 10 })], latestCertifiedSnapshotAt: '2026-11-15T17:30:00Z', now: d('2026-11-15T17:45:00Z') })
    expect(s.requests.failureRatePct).toBe(10)
  })
})
