import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))
// The Phase-14 resolver pulls prisma; the population module only needs its name normalizer.
vi.mock('@/lib/shared-services/player-identity', () => ({ normalizePlayerNameForResolution: (n: string) => n.toLowerCase().replace(/[^a-z]/g, '') }))

import { classifyCrosswalkCandidates, runEspnIdentityPopulation, type IdentityStore } from '@/lib/sports-data-gateway/runtime/espnIdentityPopulation'
import type { SleeperEspnCrosswalkRow } from '@/lib/sports-data-gateway/providers/sleeper'

const row = (sleeperId: string, espnId: string, fullName = `P${sleeperId}`, team = 'KC'): SleeperEspnCrosswalkRow => ({ sleeperId, espnId, fullName, position: 'QB', team, active: true })

// In-memory identity store simulating PlayerIdentityMap (sleeperId unique).
function memStore(seed: Array<{ sleeperId: string; espnId: string | null }> = []): IdentityStore & { rows: Map<string, { id: string; espnId: string | null }> } {
  const rows = new Map<string, { id: string; espnId: string | null }>()
  seed.forEach((s, i) => rows.set(s.sleeperId, { id: `id${i}`, espnId: s.espnId }))
  return {
    rows,
    async findExistingBySleeperIds(ids) { const m = new Map<string, { id: string; espnId: string | null }>(); for (const id of ids) { const r = rows.get(id); if (r) m.set(id, r) } return m },
    async createMappings(created) { for (const c of created) rows.set(c.sleeperId, { id: `new-${c.sleeperId}`, espnId: c.espnId }); return created.length },
    async updateEspnId(sleeperId, patch) { const r = rows.get(sleeperId); if (r) r.espnId = patch.espnId },
    async coverage() { return { identityMapRows: rows.size, withEspnId: [...rows.values()].filter((r) => r.espnId != null).length, withSleeperId: rows.size } },
  }
}
const fetcher = (rows: SleeperEspnCrosswalkRow[]) => async () => ({ rows, totalPlayers: rows.length, withEspn: rows.length })

describe('5F-c — deterministic classification (Tier-1 dual-id only; conflicts quarantined)', () => {
  it('unique espn↔sleeper pairs are verified; one espn id claimed by 2 sleeper ids is quarantined', () => {
    const { verified, conflicts } = classifyCrosswalkCandidates([row('s1', 'e1'), row('s2', 'e2'), row('s3', 'e2')])
    expect(verified.map((v) => v.sleeperId).sort()).toEqual(['s1']) // s2/s3 share e2 → conflict
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ reason: 'espn_id_multiple_sleeper', espnId: 'e2' })
  })
  it('carries no raw provider payload — only normalized canonical attributes', () => {
    const { verified } = classifyCrosswalkCandidates([row('s1', 'e1', 'Patrick Mahomes')])
    expect(Object.keys(verified[0]).sort()).toEqual(['canonicalName', 'espnId', 'normalizedName', 'position', 'sleeperId', 'team'])
    expect(verified[0].normalizedName).toBe('patrickmahomes')
  })
})

describe('5F-c — idempotent, conflict-safe population', () => {
  it('direct dual-id mapping writes safely (created)', async () => {
    const store = memStore()
    const s = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1'), row('s2', 'e2')]), store })
    expect(s.tier1Direct).toBe(2); expect(s.created).toBe(2); expect(s.conflicts).toBe(0)
    expect(store.rows.get('s1')?.espnId).toBe('e1')
  })
  it('idempotent rerun creates no duplicates (unchanged)', async () => {
    const store = memStore([{ sleeperId: 's1', espnId: 'e1' }])
    const s = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1')]), store })
    expect(s.created).toBe(0); expect(s.unchanged).toBe(1); expect(store.rows.size).toBe(1)
  })
  it('fills a null espnId on an existing sleeper row (update), but NEVER overwrites a different espnId (skip-conflict)', async () => {
    const store = memStore([{ sleeperId: 's1', espnId: null }, { sleeperId: 's2', espnId: 'OLD' }])
    const s = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1'), row('s2', 'eNEW')]), store })
    expect(s.updated).toBe(1); expect(store.rows.get('s1')?.espnId).toBe('e1') // filled
    expect(s.skippedConflict).toBe(1); expect(store.rows.get('s2')?.espnId).toBe('OLD') // never overwritten
  })
  it('provider failure produces no writes (safe partial-write prevention)', async () => {
    const store = memStore()
    const s = await runEspnIdentityPopulation({ fetch: async () => ({ error: 'HTTP 503' }), store })
    expect(s.error).toBe('HTTP 503'); expect(s.created).toBe(0); expect(store.rows.size).toBe(0)
  })
  it('dryRun classifies but writes nothing; limit makes runs resumable', async () => {
    const store = memStore()
    const dry = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1'), row('s2', 'e2')]), store, dryRun: true })
    expect(dry.tier1Direct).toBe(2); expect(dry.created).toBe(0); expect(store.rows.size).toBe(0)
    const limited = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1'), row('s2', 'e2')]), store, limit: 1 })
    expect(limited.created).toBe(1)
  })
  it('audit summary is internally consistent (verified = created + updated + unchanged + skippedConflict)', async () => {
    const store = memStore([{ sleeperId: 's2', espnId: 'OLD' }, { sleeperId: 's3', espnId: 'e3' }])
    const s = await runEspnIdentityPopulation({ fetch: fetcher([row('s1', 'e1'), row('s2', 'eNEW'), row('s3', 'e3')]), store })
    expect(s.created + s.updated + s.unchanged + s.skippedConflict).toBe(s.tier1Direct)
  })
})

describe('5F-c — provider boundary + no name matching', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/runtime/espnIdentityPopulation.ts'), 'utf8')
  it('population reaches ESPN/Sleeper ONLY through the adapter (no direct provider URL/fetch)', () => {
    expect(src).toMatch(/from '\.\.\/providers\/sleeper'/)
    // no provider URL and no BARE global fetch (delegated `src.fetch()` method calls are allowed)
    expect(src).not.toMatch(/site\.api\.espn\.com|api\.sleeper\.app/)
    expect(src).not.toMatch(/(?<![.\w])fetch\(/)
  })
  it('uses no fuzzy/name matching to create a mapping — mappings come only from Sleeper dual-id rows', () => {
    // name is never used as a MATCH key (no name lookup / no similarity). Conflict detection keys on ids only.
    expect(src).not.toMatch(/findFirst\([^)]*normalizedName|levenshtein|similarity|nameMatch/i)
    expect(src).toMatch(/espnToSleepers/) // conflict grouping keyed on ids
    expect(src).toMatch(/espn_id_multiple_sleeper/)
    // normalizedName is only ever written as a field, never used in a where/lookup
    expect(src).not.toMatch(/where:\s*\{[^}]*normalizedName/)
  })
  it('the crosswalk adapter emits only rows carrying BOTH ids (deterministic)', () => {
    const adapter = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/providers/sleeper.ts'), 'utf8')
    expect(adapter).toMatch(/if \(!sleeperId \|\| !espnId\) continue/)
  })
})
