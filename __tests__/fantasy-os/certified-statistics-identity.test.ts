import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

// Mock the ESPN provider adapter (no network) + the canonical identity resolver (deterministic outcomes).
const boxScoreMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/sports-data-gateway/providers/espn', async (orig) => {
  const actual = await orig<typeof import('@/lib/sports-data-gateway/providers/espn')>()
  return { ...actual, fetchEspnBoxScore: boxScoreMock.fn }
})
const resolveMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/shared-services/player-identity', () => ({ resolvePlayers: resolveMock.fn }))

import { normalizeEspnStat, runEspnStatisticsSync, getCertifiedPlayerStats } from '@/lib/sports-data-gateway/runtime/statisticsRuntime'
import { resolveEspnAthleteIdentities } from '@/lib/sports-data-gateway/runtime/statisticsIdentityResolver'

const athlete = (id: string, stats: Record<string, number> = { YDS: 1 }, team = 'KC') => ({ providerAthleteId: id, name: `P${id}`, teamAbbrev: team, position: 'passing', stats })
const box = (eventId: string, athletes: ReturnType<typeof athlete>[]) => ({ eventId, season: '2024', week: '1', statusName: 'STATUS_FINAL', homeAbbrev: 'KC', awayAbbrev: 'BUF', athletes })
const ctx = { eventId: '401', season: '2024', week: '1', gameStatus: 'final' as const, homeAbbrev: 'KC', awayAbbrev: 'BUF', fetchedAt: 't', snapshotVersion: 'v1' }
const result = (sourceId: string, confidence: string, canonicalPlayerId?: string) => ({ input: { provider: 'espn', sourceId }, confidence, player: canonicalPlayerId ? { canonicalPlayerId } : null, source: 'x' })

function fakeStore() {
  const persisted: unknown[] = []
  return {
    persisted,
    previousCertifiedHashes: async () => ({ snapshotId: null, hashes: new Map<string, string>() }),
    persistCertifiedSnapshot: async (d: unknown) => { persisted.push(d); return { certified: true } },
    getCertifiedRecords: async () => ({ snapshotId: 's', version: 'v', records: (persisted.at(-1) as { records?: Array<{ record: unknown }> })?.records?.map((r) => r.record) ?? [] }),
  }
}

beforeEach(() => { boxScoreMock.fn.mockReset(); resolveMock.fn.mockReset() })

describe('5F-b — deterministic identity resolver (direct only; ambiguous flagged; never name-guessed)', () => {
  it('direct provider-id match → resolved with canonical id', async () => {
    resolveMock.fn.mockResolvedValue([result('123', 'direct', 'canon:uuid-1')])
    const map = await resolveEspnAthleteIdentities(['123'])
    expect(map.get('123')).toEqual({ canonicalPlayerId: 'canon:uuid-1', state: 'resolved' })
  })
  it('name matches → ambiguous with NO canonical id (deterministic only)', async () => {
    resolveMock.fn.mockResolvedValue([result('1', 'name_match_confident', 'canon:x'), result('2', 'name_match_ambiguous', 'canon:y')])
    const map = await resolveEspnAthleteIdentities(['1', '2'])
    expect(map.get('1')).toEqual({ state: 'ambiguous' })
    expect(map.get('2')).toEqual({ state: 'ambiguous' })
  })
  it('unresolved → absent from the map', async () => {
    resolveMock.fn.mockResolvedValue([result('9', 'unresolved')])
    const map = await resolveEspnAthleteIdentities(['9'])
    expect(map.has('9')).toBe(false)
  })
})

describe('5F-b — normalization carries the 3-state identity', () => {
  it('resolved / ambiguous / unresolved map to canonicalPlayerId + identityResolution correctly', () => {
    const r = normalizeEspnStat(athlete('1'), ctx, () => ({ canonicalPlayerId: 'canon:uuid', state: 'resolved' }))
    expect(r.identityResolution).toBe('resolved'); expect(r.canonicalPlayerId).toBe('canon:uuid')
    const a = normalizeEspnStat(athlete('2'), ctx, () => ({ state: 'ambiguous' }))
    expect(a.identityResolution).toBe('ambiguous'); expect(a.canonicalPlayerId).toBe('ambiguous:espn:2')
    const u = normalizeEspnStat(athlete('3'), ctx, () => null)
    expect(u.identityResolution).toBe('unresolved'); expect(u.canonicalPlayerId).toBe('unresolved:espn:3')
  })
})

describe('5F-b — runtime enrichment, retrieval, append-only, duplicate handling', () => {
  it('runEspnStatisticsSync enriches with canonical identity + reports resolution counts; retrieval exposes them', async () => {
    boxScoreMock.fn.mockResolvedValue(box('401', [athlete('123'), athlete('456'), athlete('789')]))
    resolveMock.fn.mockResolvedValue([result('123', 'direct', 'canon:a'), result('456', 'name_match_ambiguous'), result('789', 'unresolved')])
    const store = fakeStore()
    const r = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never, resolveBatch: resolveEspnAthleteIdentities })
    expect(r.certified).toBe(true)
    expect(r.resolvedCount).toBe(1)
    expect(r.ambiguousCount).toBe(1)
    expect(r.unresolvedCount).toBe(1)
    const stats = await getCertifiedPlayerStats(store as never, '2024', '1')
    const resolved = stats.find((s) => s.identityResolution === 'resolved')
    expect(resolved?.canonicalPlayerId).toBe('canon:a')
    // runtime exposes canonicalPlayerId + identityResolution (identityState) alongside stats
    expect(stats.every((s) => 'canonicalPlayerId' in s && 'identityResolution' in s)).toBe(true)
  })
  it('resolved players key by canonical id (duplicate handling) + append-only replay is stable', async () => {
    boxScoreMock.fn.mockResolvedValue(box('401', [athlete('123')]))
    resolveMock.fn.mockResolvedValue([result('123', 'direct', 'canon:a')])
    const store = fakeStore()
    const r1 = await runEspnStatisticsSync({ season: '2024', week: '1', eventIds: ['401'], store: store as never, resolveBatch: resolveEspnAthleteIdentities })
    const draft = store.persisted[0] as { records: Array<{ canonicalKey: string; resolutionStatus: string }> }
    expect(draft.records[0].canonicalKey).toBe('espn:nfl:401:canon:a:passing') // keyed by canonical id when resolved
    expect(draft.records[0].resolutionStatus).toBe('resolved')
    expect(r1.certified).toBe(true)
  })
})

describe('5F-b — provider boundary, import guard, scoring unchanged, capability', () => {
  it('identity resolver composes the canonical resolver ONLY — no provider access', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/runtime/statisticsIdentityResolver.ts'), 'utf8')
    expect(src).toMatch(/from '@\/lib\/shared-services\/player-identity'/)
    expect(src).not.toMatch(/site\.api\.espn\.com|api\.sleeper\.app|fetch\(|providers\/espn/)
    expect(src).toMatch(/'direct'/) // only direct is resolved
  })
  it('deterministic only: the resolver never sets resolved from a name match', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/runtime/statisticsIdentityResolver.ts'), 'utf8')
    // resolved is set ONLY inside the `direct` branch; name matches set ambiguous with no canonical id.
    expect(src).toMatch(/state: 'resolved'/)
    expect(src).toMatch(/out\.set\(id, \{ state: 'ambiguous' \}\)/)
    // the only `state: 'resolved'` assignment sits after the `confidence === 'direct'` guard
    expect(src.indexOf("confidence === 'direct'")).toBeLessThan(src.indexOf("state: 'resolved'"))
    // the name-match branch never assigns a canonical id (no `canonicalPlayerId` in the ambiguous set)
    const ambIdx = src.indexOf("name_match")
    const ambBlock = src.slice(ambIdx, src.indexOf('\n    }', ambIdx))
    expect(ambBlock).not.toMatch(/canonicalPlayerId/)
  })
  it('scoring engine still uses existing inputs (does not import the certified statistics runtime)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/redraft/scoringEngine.ts'), 'utf8')
    expect(src).not.toMatch(/statisticsRuntime|getCertifiedPlayerStats/)
  })
})
