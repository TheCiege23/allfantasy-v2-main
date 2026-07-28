/**
 * Durable Sleeper read-model sync — deterministic unit coverage (no live provider, no real DB).
 *
 * Covers: enumeration include/exclude (#14/#15), read-only provider access (#17), manual-refresh
 * authorization (#16), the leased-lock adapter mechanism (#12), fetcher determinism / one-burst
 * memoization (idempotency + rate-limit signals), and runner integration (completed + immutable-skip
 * #10 + overlap-lock #12) via the collector's real fetcher over a controlled fixture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks for the import graph's side-effecting deps ────────────────────────────
const h = vi.hoisted(() => ({
  prisma: {
    league: { groupBy: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    leagueSyncState: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
  resolveLeagueAccess: vi.fn(),
  acquireAutomationLock: vi.fn(),
  releaseAutomationLock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.resolveLeagueAccess }))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: h.acquireAutomationLock,
  releaseAutomationLock: h.releaseAutomationLock,
}))
vi.mock('@/lib/sleeper-client', () => ({ getAllPlayers: vi.fn(async () => ({})) }))

import { enumerateConnectedSleeperLeagues, buildRunKey } from '@/lib/fantasy-os/sync/collector/enumerate'
import { createAutomationSyncLock } from '@/lib/fantasy-os/sync/collector/automationSyncLock'
import { createSleeperScopeFetcher } from '@/lib/fantasy-os/sync/collector/sleeperScopeFetcher'
import { manualRefreshConnectedSleeperLeague, getConnectedLeagueSyncState } from '@/lib/fantasy-os/sync/collector/manualRefresh'
import { runSync, reconcileAccounting, type SyncStore, type SyncLock, type RunResult, type ScopeFetchResult } from '@/lib/fantasy-os/sync/runner'
import { fetchSleeperLeagueForImport } from '@/lib/league-import/sleeper/SleeperLeagueFetchService'
import { createMemoizedNormalizedLoader } from '@/lib/fantasy-os/sync/collector/syncConnectedSleeperLeague'
import { assertIsolatedTestDatabase } from './fixtures/isolatedDbGuard'
import { makeSleeperNormalized } from './fixtures/sleeperNormalizedFixture'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── #14 / #15 — enumeration selects ONLY canonical imported Sleeper leagues ─────
describe('enumerateConnectedSleeperLeagues', () => {
  it('queries only platform=sleeper with a real external id (excludes AF-native + Legacy-only)', async () => {
    h.prisma.league.groupBy.mockResolvedValue([
      { platformLeagueId: 'a', season: 2025, sport: 'NFL' },
      { platformLeagueId: 'a', season: 2025, sport: 'NFL' }, // duplicate mirror row → dedupes
      { platformLeagueId: '', season: 2025, sport: 'NFL' }, // empty id → skipped
      { platformLeagueId: 'b', season: 2024, sport: 'NFL' },
    ])
    const conns = await enumerateConnectedSleeperLeagues()

    const whereArg = h.prisma.league.groupBy.mock.calls[0][0].where
    expect(whereArg.platform).toBe('sleeper')
    expect(whereArg.platformLeagueId).toEqual({ not: '' })

    expect(conns).toHaveLength(2)
    expect(conns.map((c) => c.runKey).sort()).toEqual(['sleeper:a:2025', 'sleeper:b:2024'])
    expect(conns.every((c) => c.provider === 'sleeper')).toBe(true)
  })

  it('buildRunKey is deterministic', () => {
    expect(buildRunKey('sleeper', 'X', 2025)).toBe('sleeper:X:2025')
  })
})

// ── #17 — every Sleeper provider call is read-only (GET) ────────────────────────
describe('read-only provider access', () => {
  it('fetchSleeperLeagueForImport issues only GET requests', async () => {
    const methods: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      methods.push((init?.method ?? 'GET').toUpperCase())
      const url = String(input)
      const body = url.includes('/league/123') && !url.includes('/')
        ? { league_id: '123' }
        : url.endsWith('/league/123')
          ? { league_id: '123', season: '2025', total_rosters: 2 }
          : []
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })

    await fetchSleeperLeagueForImport('123')

    expect(methods.length).toBeGreaterThan(0)
    expect(methods.every((m) => m === 'GET')).toBe(true)
    fetchSpy.mockRestore()
  })
})

// ── #16 — manual refresh / inspection require league access ─────────────────────
describe('manual refresh authorization', () => {
  it('denies a user without access (403) and never touches the provider', async () => {
    h.resolveLeagueAccess.mockResolvedValue(null)
    const fetchNormalized = vi.fn()
    const res = await manualRefreshConnectedSleeperLeague({
      userId: 'intruder', leagueId: 'L1', fetchNormalized,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(403)
    expect(fetchNormalized).not.toHaveBeenCalled()
  })

  it('rejects a non-Sleeper league (400)', async () => {
    h.resolveLeagueAccess.mockResolvedValue({ isOwner: true, isMember: true })
    h.prisma.league.findUnique.mockResolvedValue({ platform: 'manual', platformLeagueId: '', season: 2025, sport: 'NFL' })
    const res = await manualRefreshConnectedSleeperLeague({ userId: 'owner', leagueId: 'L1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
  })

  it('denies sync-state inspection without access (403)', async () => {
    h.resolveLeagueAccess.mockResolvedValue(null)
    const res = await getConnectedLeagueSyncState({ userId: 'intruder', leagueId: 'L1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(403)
  })
})

// ── #12 (mechanism) — the leased-lock adapter maps to AutomationLock ─────────────
describe('automation sync-lock adapter', () => {
  it('acquires (returns a token) and releases via AutomationLock', async () => {
    h.acquireAutomationLock.mockResolvedValue({ ok: true, backend: 'postgres' })
    const lock = createAutomationSyncLock()
    const got = await lock.acquire('sleeper:a:2025', 60_000, new Date())
    expect(got.acquired).toBe(true)
    expect(got.token).toBeTruthy()
    await lock.release('sleeper:a:2025', got.token!)
    expect(h.releaseAutomationLock).toHaveBeenCalledWith('sleeper:a:2025', got.token)
  })

  it('reports not-acquired when the lock is already held', async () => {
    h.acquireAutomationLock.mockResolvedValue({ ok: false, reason: 'Lock held (postgres)' })
    const lock = createAutomationSyncLock()
    const got = await lock.acquire('sleeper:a:2025', 60_000, new Date())
    expect(got.acquired).toBe(false)
    expect(got.token).toBeUndefined()
  })
})

// ── Fetcher determinism + one-burst memoization signal ──────────────────────────
describe('sleeper scope fetcher', () => {
  it('produces stable checkpoints (same data ⇒ same token; changed roster ⇒ new token)', async () => {
    const n1 = makeSleeperNormalized()
    const f1 = createSleeperScopeFetcher({ loadNormalized: async () => n1 })
    const a = await f1('teams_rosters', null, new Date())
    const b = await f1('teams_rosters', null, new Date())
    expect(a.nextCheckpoint).toBe(b.nextCheckpoint) // identical data → identical checkpoint (idempotency)
    expect(a.records).toHaveLength(2)

    const n2 = makeSleeperNormalized({
      rosters: [
        { teamId: '1', managerId: 'u1', players: ['p1', 'p9'], starters: ['p9'] }, // lineup changed
        { teamId: '2', managerId: 'u2', players: ['p5'], starters: ['p5'] },
      ],
    })
    const f2 = createSleeperScopeFetcher({ loadNormalized: async () => n2 })
    const c = await f2('teams_rosters', null, new Date())
    expect(c.nextCheckpoint).not.toBe(a.nextCheckpoint)
  })
})

// ── Runner integration through the collector's fetcher (completed + immutable + lock) ──
class MemStore implements SyncStore {
  checkpoints = new Map<string, string>()
  persisted = new Set<string>()
  lastSuccess: string | null = null
  runs: RunResult[] = []
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
class MemLock implements SyncLock {
  held = new Map<string, { token: string; expiresAt: number }>()
  n = 0
  async acquire(key: string, leaseMs: number, now: Date) {
    const cur = this.held.get(key)
    if (cur && cur.expiresAt > now.getTime()) return { acquired: false }
    const token = `t${++this.n}`
    this.held.set(key, { token, expiresAt: now.getTime() + leaseMs })
    return { acquired: true, token }
  }
  async release(key: string, token: string) {
    const c = this.held.get(key)
    if (c && c.token === token) this.held.delete(key)
  }
}
const clock = { now: () => new Date('2025-11-15T18:00:00Z') }
const rng = { next: () => 0.5 }
const noSleep = async () => {}

describe('runner integration via collector fetcher', () => {
  const normalized = makeSleeperNormalized()

  it('a full run completes, advances freshness, and reconciles accounting', async () => {
    const fetchScope = createSleeperScopeFetcher({ loadNormalized: async () => normalized })
    const store = new MemStore()
    const res = await runSync({
      runKey: 'sleeper:111:2025', seasonState: 'regular_season',
      scopes: ['league_state', 'teams_rosters', 'traded_picks'],
      lock: new MemLock(), store, clock, rng, sleep: noSleep, fetchScope, maxRetries: 2,
    })
    expect(res.status).toBe('completed')
    expect(res.advancedFreshness).toBe(true)
    expect(store.lastSuccess).toBeTruthy()
    expect(reconcileAccounting(res.accounting).ok).toBe(true)
  })

  it('#10 does not refetch an immutable, already-checkpointed scope', async () => {
    const loadNormalized = vi.fn(async () => normalized)
    const inner = createSleeperScopeFetcher({ loadNormalized })
    const calls: string[] = []
    const fetchScope = async (scope: string, cp: string | null, now: Date): Promise<ScopeFetchResult> => {
      calls.push(scope)
      return inner(scope, cp, now)
    }
    const store = new MemStore()
    store.checkpoints.set('sleeper:111:2025:completed_drafts', 'frozen')
    const res = await runSync({
      runKey: 'sleeper:111:2025', seasonState: 'regular_season',
      scopes: ['league_state', 'completed_drafts'], immutableScopes: ['completed_drafts'],
      lock: new MemLock(), store, clock, rng, sleep: noSleep, fetchScope,
    })
    expect(res.completedScopes).toContain('completed_drafts')
    expect(calls).not.toContain('completed_drafts') // skipped — never refetched
    expect(res.accounting.cacheHits).toBe(1)
  })

  it('#12 an overlapping run is locked out', async () => {
    const lock = new MemLock()
    await lock.acquire('sleeper:111:2025', 60_000, clock.now()) // held by another executor
    const fetchScope = createSleeperScopeFetcher({ loadNormalized: async () => normalized })
    const res = await runSync({
      runKey: 'sleeper:111:2025', seasonState: 'regular_season', scopes: ['league_state'],
      lock, store: new MemStore(), clock, rng, sleep: noSleep, fetchScope,
    })
    expect(res.status).toBe('locked')
  })
})

// ── #F1 / #G2 — fail-closed EXACT-host isolated-DB guard ─────────────────────────
describe('fail-closed isolated-DB guard (exact host allowlist)', () => {
  const POOLER = 'postgresql://u:pw@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb'
  const DIRECT = 'postgresql://u:pw@ep-muddy-leaf-adigvvph.c-2.us-east-1.aws.neon.tech/neondb'
  const PROD = 'postgresql://u:pw@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb'

  it('accepts EXACTLY the approved pooler + direct hostnames WITH opt-in', () => {
    expect(assertIsolatedTestDatabase(POOLER, 'true').host).toBe('ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech')
    expect(assertIsolatedTestDatabase(DIRECT, 'true').host).toBe('ep-muddy-leaf-adigvvph.c-2.us-east-1.aws.neon.tech')
  })
  it('refuses the exact approved host WITHOUT the opt-in flag', () => {
    expect(() => assertIsolatedTestDatabase(POOLER, undefined)).toThrow(/opt in/i)
    expect(() => assertIsolatedTestDatabase(POOLER, 'false')).toThrow(/opt in/i)
  })
  it('refuses a host that merely CONTAINS the approved name (suffix + prefix attacks)', () => {
    expect(() => assertIsolatedTestDatabase('postgresql://u:pw@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech.attacker.com/neondb', 'true')).toThrow(/EXACT approved/i)
    expect(() => assertIsolatedTestDatabase('postgresql://u:pw@evil-ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb', 'true')).toThrow(/EXACT approved/i)
  })
  it('refuses ep-muddy-leaf.example.com', () => {
    expect(() => assertIsolatedTestDatabase('postgresql://u:pw@ep-muddy-leaf.example.com/neondb', 'true')).toThrow(/EXACT approved/i)
  })
  it('refuses a valid-looking but DIFFERENT Neon endpoint', () => {
    expect(() => assertIsolatedTestDatabase('postgresql://u:pw@ep-shiny-water-abcd1234-pooler.c-2.us-east-1.aws.neon.tech/neondb', 'true')).toThrow(/EXACT approved/i)
  })
  it('refuses a non-postgres scheme even on the approved host', () => {
    expect(() => assertIsolatedTestDatabase('mysql://u:pw@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb', 'true')).toThrow(/scheme/i)
  })
  it('refuses the exact approved host with the WRONG database name', () => {
    expect(() => assertIsolatedTestDatabase(POOLER.replace('/neondb', '/otherdb'), 'true')).toThrow(/not the approved name/i)
  })
  it('refuses the known PRODUCTION endpoint (exact)', () => {
    expect(() => assertIsolatedTestDatabase(PROD, 'true')).toThrow(/production/i)
  })
  it('refuses a missing URL', () => {
    expect(() => assertIsolatedTestDatabase(undefined, 'true')).toThrow(/missing/i)
    expect(() => assertIsolatedTestDatabase('', 'true')).toThrow(/missing/i)
  })
  it('refuses a malformed URL', () => {
    expect(() => assertIsolatedTestDatabase('::: not a url', 'true')).toThrow(/malformed|unparseable/i)
  })
  it('never leaks credentials or query params in a refusal message', () => {
    // Synthetic, obviously-fake credentials (fake user "test_user", fake password "dummy"). Uses the
    // real prod hostname (a hostname is not a secret) to hit the production branch, plus query params.
    const withFakeCreds = 'postgresql://test_user:dummy@ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&token=xyz'
    let msg = ''
    try { assertIsolatedTestDatabase(withFakeCreds, 'true') } catch (e) { msg = String((e as Error).message) }
    expect(msg).toMatch(/production/i)
    expect(msg).not.toContain('dummy') // password stripped
    expect(msg).not.toContain('test_user') // username stripped
    expect(msg).not.toContain('token=xyz') // query stripped
    expect(msg).not.toContain('sslmode') // query stripped
  })
})

// ── #F3 — memoized loader makes runner retries real ─────────────────────────────
describe('createMemoizedNormalizedLoader', () => {
  it('a normal successful multi-scope run calls the loader EXACTLY ONCE', async () => {
    let calls = 0
    const load = createMemoizedNormalizedLoader(async () => { calls++; return makeSleeperNormalized() })
    const a = await load(); const b = await load(); const c = await load()
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
  it('one transient failure followed by success results in EXACTLY TWO loader calls', async () => {
    let calls = 0
    const load = createMemoizedNormalizedLoader(async () => {
      calls += 1
      if (calls === 1) throw new Error('transient provider error')
      return makeSleeperNormalized()
    })
    await expect(load()).rejects.toThrow('transient') // rejection releases the memo slot
    const ok = await load() // retry performs a genuinely new attempt
    expect(calls).toBe(2)
    expect(ok).toBeTruthy()
    await load() // later scopes reuse the resolved payload — no third call
    expect(calls).toBe(2)
  })
})
