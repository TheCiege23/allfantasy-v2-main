import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

// Stub the ESPN provider adapter (the only provider-touching module) so the runtime never hits the network.
const boxScoreMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/sports-data-gateway/providers/espn', async (orig) => {
  const actual = await orig<typeof import('@/lib/sports-data-gateway/providers/espn')>()
  return { ...actual, fetchEspnBoxScore: boxScoreMock.fn }
})

import { runEspnStatisticsSync, normalizeEspnStat, statContentHash, getCertifiedPlayerStats } from '@/lib/sports-data-gateway/runtime/statisticsRuntime'
import { EspnAdapter } from '@/lib/sports-data-gateway/providers/espn'

const athlete = (id: string, stats: Record<string, number>, team = 'KC') => ({ providerAthleteId: id, name: `Player ${id}`, teamAbbrev: team, position: 'passing', stats })
const box = (eventId: string, athletes: ReturnType<typeof athlete>[], status = 'STATUS_FINAL') => ({ eventId, season: '2024', week: '1', statusName: status, homeAbbrev: 'KC', awayAbbrev: 'BUF', athletes })

// Minimal fake store capturing persisted drafts + replaying previous hashes.
function fakeStore() {
  const persisted: unknown[] = []
  let prevHashes = new Map<string, string>()
  return {
    persisted,
    setPrev: (m: Map<string, string>) => { prevHashes = m },
    previousCertifiedHashes: async () => ({ snapshotId: persisted.length ? 'prev' : null, hashes: prevHashes }),
    persistCertifiedSnapshot: async (draft: unknown) => { persisted.push(draft); return { certified: true } },
    getCertifiedRecords: async () => ({ snapshotId: 's', version: 'v', records: (persisted.at(-1) as { records?: Array<{ record: unknown }> })?.records?.map((r) => r.record) ?? [] }),
  }
}

const ctx = { eventId: '401', season: '2024', week: '1', gameStatus: 'final' as const, homeAbbrev: 'KC', awayAbbrev: 'BUF', fetchedAt: 't', snapshotVersion: 'v1' }

beforeEach(() => boxScoreMock.fn.mockReset())

describe('5F-a — statistics normalization + identity', () => {
  it('normalizes an ESPN box-score athlete to canonical shape (no raw provider payload; numeric stats only)', () => {
    const s = normalizeEspnStat(athlete('99', { YDS: 305, TD: 2 }), ctx)
    expect(s.canonicalGameId).toBe('espn:nfl:401')
    expect(s.teamId).toBe('nfl:KC')
    expect(s.opponentTeamId).toBe('nfl:BUF')
    expect(s.statCategories).toEqual({ YDS: 305, TD: 2 })
    // no raw provider fields leak
    expect(Object.keys(s).sort()).toEqual(['canonicalGameId', 'canonicalPlayerId', 'gameStatus', 'identityResolution', 'opponentTeamId', 'position', 'season', 'source', 'statCategories', 'teamId', 'week'])
    expect(JSON.stringify(s)).not.toMatch(/athlete|displayName|providerAthleteId/)
  })
  it('classifies player identity as unresolved without a resolver, resolved with a deterministic one', () => {
    expect(normalizeEspnStat(athlete('99', {}), ctx).identityResolution).toBe('unresolved')
    expect(normalizeEspnStat(athlete('99', {}), ctx).canonicalPlayerId).toBe('unresolved:espn:99')
    const resolved = normalizeEspnStat(athlete('99', {}), ctx, () => ({ canonicalPlayerId: 'canon:mahomes', state: 'resolved' }))
    expect(resolved.identityResolution).toBe('resolved')
    expect(resolved.canonicalPlayerId).toBe('canon:mahomes')
  })
  it('content hash is deterministic + duplicate detection sees identical stats as unchanged', () => {
    const a = normalizeEspnStat(athlete('99', { YDS: 1 }), ctx)
    const b = normalizeEspnStat(athlete('99', { YDS: 1 }), ctx)
    expect(statContentHash(a)).toBe(statContentHash(b))
    expect(statContentHash(normalizeEspnStat(athlete('99', { YDS: 2 }), ctx))).not.toBe(statContentHash(a))
  })
})

describe('5F-a — certification + append-only + runtime retrieval', () => {
  it('certifies a real box-score snapshot + retrieval returns canonical stats', async () => {
    boxScoreMock.fn.mockResolvedValue(box('401', [athlete('99', { YDS: 305 }), athlete('12', { REC: 8 }, 'BUF')]))
    const store = fakeStore()
    const r = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never })
    expect(r.certified).toBe(true)
    expect(r.statCount).toBe(2)
    expect(r.gamesFetched).toBe(1)
    expect(r.created).toBe(2)
    const stats = await getCertifiedPlayerStats(store as never, '2024', '1')
    expect(stats.length).toBe(2)
    expect(stats[0].canonicalGameId).toBe('espn:nfl:401')
  })
  it('append-only: duplicate re-run suppresses unchanged; correction replay marks changed (never overwrites in place)', async () => {
    boxScoreMock.fn.mockResolvedValue(box('401', [athlete('99', { YDS: 305 })]))
    const store = fakeStore()
    const first = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never })
    // replay previous hashes as if the first snapshot were certified (key includes stat group)
    const key = 'espn:nfl:401:unresolved:espn:99:passing'
    store.setPrev(new Map([[key, statContentHash(normalizeEspnStat(athlete('99', { YDS: 305 }), ctx))]]))
    const same = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never })
    expect(same.suppressed).toBe(1)
    expect(same.created).toBe(0)
    // a stat correction (different value) → a NEW snapshot with changed>0
    boxScoreMock.fn.mockResolvedValue(box('401', [athlete('99', { YDS: 999 })]))
    const corrected = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never })
    expect(corrected.changed).toBe(1)
    expect(corrected.certified).toBe(true)
    expect(first.certified).toBe(true) // original still stands (append-only)
  })
  it('no box-score stats (games not played) → NOT certified, honest reason (snapshot replacement prevention)', async () => {
    boxScoreMock.fn.mockResolvedValue(box('401', []))
    const store = fakeStore()
    const r = await runEspnStatisticsSync({ season: '2026', week: '1', eventIds: ['401'], store: store as never })
    expect(r.certified).toBe(false)
    expect(r.reason).toMatch(/no box-score stats/i)
    expect(store.persisted.length).toBe(0) // never persists an uncertifiable snapshot
  })
  it('provider fetch failure is recorded, never fabricated', async () => {
    boxScoreMock.fn.mockResolvedValue({ error: 'HTTP 503' })
    const store = fakeStore()
    const r = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never })
    expect(r.gamesFailed).toBe(1)
    expect(r.certified).toBe(false)
  })
})

describe('5F-a — capability registration + import guard + no raw exposure', () => {
  it('the ESPN adapter now declares the statistics capability', () => {
    const caps = new EspnAdapter().getCapabilities()
    expect(caps.capabilities).toContain('statistics')
  })
  it('statistics runtime reaches providers ONLY through the gateway adapter (no direct provider URL)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/runtime/statisticsRuntime.ts'), 'utf8')
    expect(src).toMatch(/from '\.\.\/providers\/espn'/)
    expect(src).not.toMatch(/site\.api\.espn\.com|api\.sleeper\.app|fetch\(/)
  })
  it('the canonical stat contract carries no raw provider payload fields', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/contracts.ts'), 'utf8')
    const block = src.slice(src.indexOf('CanonicalPlayerGameStat'), src.indexOf('CanonicalPlayerGameStat') + 600)
    expect(block).not.toMatch(/rawPayload|providerPayload|athlete\?:/)
  })
})
