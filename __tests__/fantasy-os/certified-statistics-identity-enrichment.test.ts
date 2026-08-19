import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/shared-services/player-identity', () => ({ normalizePlayerNameForResolution: (n: string) => n.toLowerCase().replace(/[^a-z]/g, '') }))

import { classifyMultiSourceCandidates, runMultiSourceIdentityPopulation, type IdentityStore } from '@/lib/sports-data-gateway/runtime/espnIdentityPopulation'
import type { SleeperEspnCrosswalkRow } from '@/lib/sports-data-gateway/providers/sleeper'

const row = (sleeperId: string, espnId: string, fullName = `P${sleeperId}`): SleeperEspnCrosswalkRow => ({ sleeperId, espnId, fullName, position: 'QB', team: 'KC', active: true })
const src = (name: string, rows: SleeperEspnCrosswalkRow[]) => ({ name, fetch: async () => ({ rows, totalPlayers: rows.length, withEspn: rows.length }) })
function memStore(seed: Array<{ sleeperId: string; espnId: string | null }> = []): IdentityStore & { rows: Map<string, { id: string; espnId: string | null }> } {
  const rows = new Map<string, { id: string; espnId: string | null }>(); seed.forEach((s, i) => rows.set(s.sleeperId, { id: `id${i}`, espnId: s.espnId }))
  return { rows,
    async findExistingBySleeperIds(ids) { const m = new Map<string, { id: string; espnId: string | null }>(); for (const id of ids) { const r = rows.get(id); if (r) m.set(id, r) } return m },
    async createMappings(c) { for (const x of c) rows.set(x.sleeperId, { id: `n-${x.sleeperId}`, espnId: x.espnId }); return c.length },
    async updateEspnId(sleeperId, patch) { const r = rows.get(sleeperId); if (r) r.espnId = patch.espnId },
    async coverage() { return { identityMapRows: rows.size, withEspnId: [...rows.values()].filter((r) => r.espnId != null).length, withSleeperId: rows.size } } }
}

describe('5F-d — multi-source classification (priority, agreement, conflict, cumulative)', () => {
  it('attributes agreed mappings to the highest-precedence source; unique-to-B counts for B (cumulative enrichment)', () => {
    const { verified, contributionBySource } = classifyMultiSourceCandidates([
      { name: 'sleeper', rows: [row('s1', 'e1'), row('s2', 'e2')] },       // sleeper: s1,s2
      { name: 'fantasycalc', rows: [row('s2', 'e2'), row('s3', 'e3')] },   // fc agrees on s2, adds s3
    ])
    expect(verified).toHaveLength(3)
    expect(contributionBySource).toEqual({ sleeper: 2, fantasycalc: 1 }) // s1,s2 → sleeper; s3 → fantasycalc
  })
  it('cross-source disagreement on the same sleeper id is quarantined (never resolved)', () => {
    const { verified, conflicts } = classifyMultiSourceCandidates([
      { name: 'sleeper', rows: [row('s1', 'e1')] },
      { name: 'fantasycalc', rows: [row('s1', 'eX')] }, // same sleeper, different espn → conflict
    ])
    expect(verified.find((v) => v.sleeperId === 's1')).toBeUndefined()
    expect(conflicts.some((c) => c.reason === 'sleeper_id_espn_mismatch')).toBe(true)
  })
  it('one espn id claimed by two sleeper ids across sources is quarantined', () => {
    const { verified, conflicts } = classifyMultiSourceCandidates([
      { name: 'sleeper', rows: [row('s1', 'e1')] },
      { name: 'fantasycalc', rows: [row('s2', 'e1')] }, // same espn, different sleeper
    ])
    expect(verified).toHaveLength(0)
    expect(conflicts.some((c) => c.reason === 'espn_id_multiple_sleeper')).toBe(true)
  })
  it('duplicate mapping in both sources yields one verified record', () => {
    const { verified } = classifyMultiSourceCandidates([{ name: 'a', rows: [row('s1', 'e1')] }, { name: 'b', rows: [row('s1', 'e1')] }])
    expect(verified).toHaveLength(1)
  })
})

describe('5F-d — multi-source population (idempotent, conflict-safe, per-source report)', () => {
  it('creates from both sources; secondary fills only what the primary lacked', async () => {
    const store = memStore()
    const s = await runMultiSourceIdentityPopulation({ sources: [src('sleeper', [row('s1', 'e1')]), src('fantasycalc', [row('s1', 'e1'), row('s2', 'e2')])], store })
    expect(s.created).toBe(2)
    expect(s.sources.find((x) => x.name === 'sleeper')?.contributed).toBe(1)
    expect(s.sources.find((x) => x.name === 'fantasycalc')?.contributed).toBe(1) // s2 is fc-only
  })
  it('idempotent rerun makes no new writes (unchanged)', async () => {
    const store = memStore([{ sleeperId: 's1', espnId: 'e1' }])
    const s = await runMultiSourceIdentityPopulation({ sources: [src('sleeper', [row('s1', 'e1')])], store })
    expect(s.created).toBe(0); expect(s.unchanged).toBe(1)
  })
  it('never overwrites a different existing espn id (skip-conflict)', async () => {
    const store = memStore([{ sleeperId: 's1', espnId: 'OLD' }])
    const s = await runMultiSourceIdentityPopulation({ sources: [src('fantasycalc', [row('s1', 'eNEW')])], store })
    expect(s.skippedConflict).toBe(1); expect(store.rows.get('s1')?.espnId).toBe('OLD')
  })
  it('one failing source does not block the others and is reported', async () => {
    const store = memStore()
    const failing = { name: 'fantasycalc', fetch: async () => ({ error: 'HTTP 503' }) }
    const s = await runMultiSourceIdentityPopulation({ sources: [src('sleeper', [row('s1', 'e1')]), failing], store })
    expect(s.created).toBe(1); expect(s.sources.find((x) => x.name === 'fantasycalc')?.error).toBe('HTTP 503')
  })
})

describe('5F-d — provider boundary + deterministic (no name matching)', () => {
  it('FantasyCalc crosswalk adapter emits only dual-id rows; no name matching', () => {
    const src2 = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/providers/fantasycalc.ts'), 'utf8')
    expect(src2).toMatch(/if \(!sleeperId \|\| !espnId\) continue/)
    expect(src2).not.toMatch(/levenshtein|similarity|nameMatch|fuzzy match/i)
  })
  it('population reaches providers only via gateway adapters (no direct provider url/fetch in the runtime module)', () => {
    const src2 = fs.readFileSync(path.join(process.cwd(), 'lib/sports-data-gateway/runtime/espnIdentityPopulation.ts'), 'utf8')
    // no provider URL and no BARE global fetch (delegated `src.fetch()` method calls are allowed)
    expect(src2).not.toMatch(/api\.fantasycalc\.com|api\.sleeper\.app/)
    expect(src2).not.toMatch(/(?<![.\w])fetch\(/)
  })
})
