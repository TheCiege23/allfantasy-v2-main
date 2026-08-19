import { describe, it, expect } from 'vitest'
import { resolveSeasonState, resolveCadence, cadenceForState } from '@/lib/fantasy-os/sync/season'
import { computeSyncStatus, freshnessSeverity, buildFreshness, freshnessThresholds, isSyncDue } from '@/lib/fantasy-os/sync/freshness'
import {
  runSync,
  reconcileAccounting,
  OFFSEASON_SCOPES,
  type SyncLock,
  type SyncStore,
  type RunResult,
  type ScopeFetchResult,
} from '@/lib/fantasy-os/sync/runner'

const d = (iso: string) => new Date(iso)

// ── Season resolver + cadence ──────────────────────────────────────────────────
describe('season-aware cadence', () => {
  it('in-season (regular season) resolves to 30 minutes', () => {
    const r = resolveCadence({ sport: 'nfl', provider: 'sleeper', now: d('2025-11-15T18:00:00Z') })
    expect(r.state).toBe('regular_season')
    expect(r.cadenceMinutes).toBe(30)
  })
  it('offseason resolves to 4 hours (240 min)', () => {
    const r = resolveCadence({ sport: 'nfl', now: d('2025-05-01T12:00:00Z') })
    expect(r.state).toBe('offseason')
    expect(r.cadenceMinutes).toBe(240)
  })
  it('preseason and postseason resolve to 30 minutes', () => {
    expect(resolveSeasonState({ sport: 'nfl', now: d('2025-08-15T00:00:00Z') }).state).toBe('preseason')
    expect(resolveSeasonState({ sport: 'nfl', now: d('2026-01-25T00:00:00Z') }).state).toBe('postseason')
    expect(cadenceForState('preseason')).toBe(30)
    expect(cadenceForState('postseason')).toBe(30)
  })
  it('unknown sport/provider falls back safely to 4h + warning', () => {
    const s = resolveSeasonState({ sport: 'quidditch', now: d('2025-11-15T00:00:00Z') })
    expect(s.state).toBe('unknown')
    expect(s.warning).toBeTruthy()
    expect(cadenceForState('unknown')).toBe(240)
    const p = resolveSeasonState({ sport: 'nfl', provider: 'draftkings', now: d('2025-11-15T00:00:00Z') })
    expect(p.state).toBe('unknown')
  })
  it('daylight-saving clock shifts do not alter cadence (same UTC date → same state)', () => {
    // US DST fall-back day 2025-11-02: two different clock instants, same UTC date.
    const a = resolveCadence({ sport: 'nfl', now: d('2025-11-02T05:30:00Z') })
    const b = resolveCadence({ sport: 'nfl', now: d('2025-11-02T08:30:00Z') })
    expect(a.state).toBe(b.state)
    expect(a.cadenceMinutes).toBe(b.cadenceMinutes)
    expect(a.cadenceMinutes).toBe(30)
  })
})

// ── Freshness contract ─────────────────────────────────────────────────────────
describe('freshness contract', () => {
  const now = d('2025-11-15T12:00:00Z')
  it('in-season current within 45m, delayed after', () => {
    expect(computeSyncStatus({ seasonState: 'regular_season', lastSuccessfulSyncAt: d('2025-11-15T11:30:00Z').toISOString(), now })).toBe('current')
    expect(computeSyncStatus({ seasonState: 'regular_season', lastSuccessfulSyncAt: d('2025-11-15T10:00:00Z').toISOString(), now })).toBe('delayed')
  })
  it('offseason current within 5h', () => {
    const off = d('2025-05-15T12:00:00Z')
    expect(computeSyncStatus({ seasonState: 'offseason', lastSuccessfulSyncAt: d('2025-05-15T08:30:00Z').toISOString(), now: off })).toBe('current')
    expect(computeSyncStatus({ seasonState: 'offseason', lastSuccessfulSyncAt: d('2025-05-15T02:00:00Z').toISOString(), now: off })).toBe('delayed')
  })
  it('never-synced is unavailable; refreshing/partial take precedence', () => {
    expect(computeSyncStatus({ seasonState: 'regular_season', lastSuccessfulSyncAt: null, now })).toBe('unavailable')
    expect(computeSyncStatus({ seasonState: 'regular_season', lastSuccessfulSyncAt: null, now, refreshing: true })).toBe('refreshing')
    expect(computeSyncStatus({ seasonState: 'regular_season', lastSuccessfulSyncAt: d('2025-11-15T11:59:00Z').toISOString(), now, partial: true })).toBe('partial')
  })
  it('severity escalates ok → delayed → critical', () => {
    expect(freshnessSeverity('regular_season', 30)).toBe('ok')
    expect(freshnessSeverity('regular_season', 60)).toBe('delayed')
    expect(freshnessSeverity('regular_season', 120)).toBe('critical')
    expect(freshnessThresholds('offseason')).toEqual({ currentMax: 300, criticalMax: 480 })
  })
  it('stale real data stays delayed (not relabeled) and reports last update', () => {
    const f = buildFreshness({
      seasonState: 'regular_season', lastSuccessfulSyncAt: d('2025-11-15T09:00:00Z').toISOString(),
      lastAttemptedSyncAt: d('2025-11-15T11:55:00Z').toISOString(), now, sourceProvider: 'p',
      sourceWindowStart: '2019', sourceWindowEnd: '2025',
    })
    expect(f.syncStatus).toBe('delayed')
    expect(f.refreshCadenceMinutes).toBe(30)
    expect(f.nextScheduledSyncAt).toBeTruthy()
  })
})

describe('season-aware due-check', () => {
  const now = d('2025-11-15T12:00:00Z')
  it('is due when never run', () => {
    expect(isSyncDue(null, 30, now)).toBe(true)
  })
  it('in-season: due after 30 minutes, not before', () => {
    expect(isSyncDue(d('2025-11-15T11:31:00Z').toISOString(), 30, now)).toBe(false)
    expect(isSyncDue(d('2025-11-15T11:29:00Z').toISOString(), 30, now)).toBe(true)
  })
  it('offseason: due after 4 hours, not before', () => {
    const off = d('2025-05-15T12:00:00Z')
    expect(isSyncDue(d('2025-05-15T09:00:00Z').toISOString(), 240, off)).toBe(false)
    expect(isSyncDue(d('2025-05-15T07:00:00Z').toISOString(), 240, off)).toBe(true)
  })
})

// ── Scheduler / runner fakes ─────────────────────────────────────────────────────
class FakeClock {
  constructor(public t: number) {}
  now() { return new Date(this.t) }
  advance(ms: number) { this.t += ms }
}
const rng = { next: () => 0.5 }
const noSleep = async () => {}
let tok = 0
class FakeLock implements SyncLock {
  held = new Map<string, { token: string; expiresAt: number }>()
  async acquire(key: string, leaseMs: number, now: Date) {
    const cur = this.held.get(key)
    if (cur && cur.expiresAt > now.getTime()) return { acquired: false }
    const token = `t${++tok}`
    this.held.set(key, { token, expiresAt: now.getTime() + leaseMs })
    return { acquired: true, token }
  }
  async release(key: string, token: string) {
    const c = this.held.get(key)
    if (c && c.token === token) this.held.delete(key)
  }
}
class FakeStore implements SyncStore {
  checkpoints = new Map<string, string>()
  persisted = new Set<string>()
  lastSuccess: string | null = null
  runs: RunResult[] = []
  seenCheckpoints: Record<string, string | null> = {}
  async getCheckpoint(rk: string, s: string) { return this.checkpoints.get(`${rk}:${s}`) ?? null }
  async saveCheckpoint(rk: string, s: string, c: string) { this.checkpoints.set(`${rk}:${s}`, c) }
  async persistScope(_rk: string, _s: string, records: { id: string }[]) {
    let imported = 0, unchanged = 0
    for (const r of records) { if (this.persisted.has(r.id)) unchanged++; else { this.persisted.add(r.id); imported++ } }
    return { imported, unchanged, rejected: 0 }
  }
  async recordRun(r: RunResult) { this.runs.push(r) }
  async setLastSuccessfulSyncAt(_rk: string, iso: string) { this.lastSuccess = iso }
}

const okFetch = (records: { id: string }[], cp = 'cp1'): ScopeFetchResult => ({ records, nextCheckpoint: cp, attempts: 1, logical: 1, notFound: 0, cacheHits: 0 })

describe('sync runner', () => {
  const base = { clock: new FakeClock(Date.parse('2025-11-15T12:00:00Z')), rng, sleep: noSleep, seasonState: 'regular_season' as const }

  it('completes, advances freshness, and accounting reconciles exactly', async () => {
    const store = new FakeStore()
    const res = await runSync({
      ...base, clock: new FakeClock(Date.parse('2025-11-15T12:00:00Z')), runKey: 'k1', scopes: ['a', 'b'],
      lock: new FakeLock(), store, fetchScope: async (s) => okFetch([{ id: `${s}-1` }, { id: `${s}-2` }]),
    })
    expect(res.status).toBe('completed')
    expect(res.advancedFreshness).toBe(true)
    expect(store.lastSuccess).toBeTruthy()
    expect(res.accounting.imported).toBe(4)
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })

  it('prevents overlapping runs (lock held → locked)', async () => {
    const lock = new FakeLock()
    await lock.acquire('k', 60_000, new Date(base.clock.t)) // held by someone else
    const res = await runSync({ ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['a'], lock, store: new FakeStore(), fetchScope: async () => okFetch([{ id: 'x' }]) })
    expect(res.status).toBe('locked')
  })

  it('recovers a stale (expired) lock', async () => {
    const lock = new FakeLock()
    lock.held.set('k', { token: 'old', expiresAt: Date.parse('2025-11-15T11:00:00Z') }) // already expired
    const res = await runSync({ ...base, clock: new FakeClock(Date.parse('2025-11-15T12:00:00Z')), runKey: 'k', scopes: ['a'], lock, store: new FakeStore(), fetchScope: async () => okFetch([{ id: 'x' }]) })
    expect(res.status).toBe('completed')
  })

  it('retries do not create duplicate records (idempotent across reruns)', async () => {
    const store = new FakeStore()
    const opts = { ...base, runKey: 'k', scopes: ['a'], lock: new FakeLock(), store, fetchScope: async () => okFetch([{ id: 'dup-1' }, { id: 'dup-2' }]) }
    const r1 = await runSync({ ...opts, clock: new FakeClock(base.clock.t) })
    const r2 = await runSync({ ...opts, clock: new FakeClock(base.clock.t + 1000) })
    expect(r1.accounting.imported).toBe(2)
    expect(r2.accounting.imported).toBe(0)
    expect(r2.accounting.unchanged).toBe(2)
  })

  it('resumes from the saved checkpoint', async () => {
    const store = new FakeStore()
    store.checkpoints.set('k:a', 'cp-prev')
    let seen: string | null = 'unset'
    await runSync({ ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['a'], lock: new FakeLock(), store, fetchScope: async (_s, cp) => { seen = cp; return okFetch([{ id: 'x' }], 'cp-next') } })
    expect(seen).toBe('cp-prev')
    expect(store.checkpoints.get('k:a')).toBe('cp-next')
  })

  it('does not refetch immutable, already-checkpointed scopes', async () => {
    const store = new FakeStore()
    store.checkpoints.set('k:history', 'frozen')
    let called = false
    const res = await runSync({
      ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['history'], immutableScopes: ['history'],
      lock: new FakeLock(), store, fetchScope: async () => { called = true; throw new Error('should not fetch') },
    })
    expect(called).toBe(false)
    expect(res.completedScopes).toContain('history')
    expect(res.accounting.cacheHits).toBe(1)
  })

  it('a fully failed run does NOT advance freshness', async () => {
    const store = new FakeStore()
    const res = await runSync({ ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['a'], lock: new FakeLock(), store, maxRetries: 1, fetchScope: async () => { throw new Error('boom') } })
    expect(res.status).toBe('failed')
    expect(res.advancedFreshness).toBe(false)
    expect(store.lastSuccess).toBeNull()
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })

  it('labels a partial run correctly and does not advance freshness', async () => {
    const store = new FakeStore()
    const res = await runSync({
      ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['good', 'bad'], lock: new FakeLock(), store, maxRetries: 1,
      fetchScope: async (s) => { if (s === 'bad') throw new Error('x'); return okFetch([{ id: 'g' }]) },
    })
    expect(res.status).toBe('partial')
    expect(res.completedScopes).toEqual(['good'])
    expect(res.incompleteScopes).toEqual(['bad'])
    expect(res.advancedFreshness).toBe(false)
    expect(store.lastSuccess).toBeNull()
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })

  it('imports offseason week-0 activity via the enrichment scope set', async () => {
    const store = new FakeStore()
    const res = await runSync({
      ...base, seasonState: 'offseason', clock: new FakeClock(Date.parse('2025-05-01T12:00:00Z')), runKey: 'off',
      scopes: OFFSEASON_SCOPES, lock: new FakeLock(), store,
      fetchScope: async (s) => okFetch([{ id: `${s}-r1` }]),
    })
    expect(res.status).toBe('completed')
    expect(res.completedScopes).toContain('offseason_trades')
    expect(res.completedScopes).toContain('rookie_drafts')
    expect(res.accounting.imported).toBe(OFFSEASON_SCOPES.length)
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })

  it('accounting reconciles when a scope retries then succeeds', async () => {
    const store = new FakeStore()
    let n = 0
    const res = await runSync({
      ...base, clock: new FakeClock(base.clock.t), runKey: 'k', scopes: ['a'], lock: new FakeLock(), store, maxRetries: 3,
      fetchScope: async () => { if (n++ < 2) throw new Error('transient'); return okFetch([{ id: 'x' }]) },
    })
    expect(res.status).toBe('completed')
    // 2 failed retry attempts + 1 successful attempt (1 logical) = 3 attempts, 1 logical, 2 retries
    expect(res.accounting.requestAttempts).toBe(3)
    expect(res.accounting.logicalRequests).toBe(1)
    expect(res.accounting.retries).toBe(2)
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })
})
