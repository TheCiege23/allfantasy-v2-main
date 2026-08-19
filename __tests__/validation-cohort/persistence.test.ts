/**
 * Fantasy OS Suite — Phase V8.1: historical evidence persistence tests.
 *
 * Fixture/DI + a real temp FileEvidenceStore — no live Sleeper calls. Covers the store contract,
 * incremental sync policy, engineering integrity checks, and the end-to-end persist orchestrator
 * (including restartability: completed seasons are imported once, the current season refreshes).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeCohort } from '@/lib/validation-cohort/normalizeCohort'
import type { SleeperFetch } from '@/lib/validation-cohort/sleeperCohortClient'
import { FileEvidenceStore } from '@/lib/validation-cohort/persistence/fileEvidenceStore'
import { planSync, isCompletedSeason } from '@/lib/validation-cohort/persistence/syncPlanner'
import { checkEvidenceIntegrity } from '@/lib/validation-cohort/persistence/integrityChecker'
import { persistPortfolio } from '@/lib/validation-cohort/persistence/persistPortfolio'
import type { PersistedLeagueEvidence } from '@/lib/validation-cohort/persistence/evidenceStore'
import type { DiscoveredLeague } from '@/lib/validation-cohort/types'

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-store-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function leagueEvidence(over: Partial<PersistedLeagueEvidence> = {}): PersistedLeagueEvidence {
  return {
    leagueReference: 'lg_aaaa',
    season: '2023',
    sport: 'NFL',
    previousLeagueRef: null,
    role: 'commissioner',
    evidence: { metadata: true },
    seasonImmutable: true,
    importedAt: new Date().toISOString(),
    ...over,
  }
}

describe('FileEvidenceStore contract', () => {
  it('upserts and reads leagues, portfolios, and import state; is restartable', async () => {
    const store = new FileEvidenceStore(tmp)
    await store.upsertLeagueEvidence(leagueEvidence({ leagueReference: 'lg_1' }))
    expect(await store.hasLeague('lg_1')).toBe(true)
    expect((await store.getLeague('lg_1'))!.season).toBe('2023')

    await store.upsertPortfolio({ accountReference: 'acct_1', seasonsDiscovered: ['2023'], leagueRefs: ['lg_1'], updatedAt: 'now' })
    expect(await store.listPortfolios()).toHaveLength(1)

    const st = await store.readImportState()
    st.importedLeagues = 5
    await store.writeImportState(st)
    // a fresh store instance on the same dir sees persisted state (restartable)
    expect((await new FileEvidenceStore(tmp).readImportState()).importedLeagues).toBe(5)
  })

  it('never overwrites an immutable completed season', async () => {
    const store = new FileEvidenceStore(tmp)
    await store.upsertLeagueEvidence(leagueEvidence({ leagueReference: 'lg_imm', seasonImmutable: true, role: 'commissioner' }))
    await store.upsertLeagueEvidence(leagueEvidence({ leagueReference: 'lg_imm', seasonImmutable: true, role: 'member' }))
    expect((await store.getLeague('lg_imm'))!.role).toBe('commissioner') // first write preserved
  })
})

describe('syncPlanner', () => {
  const mk = (ref: string, season: string): DiscoveredLeague => ({ leagueReference: ref, season, sport: 'NFL', previousLeagueRef: null, role: 'unknown' })

  it('classifies seasons and skips already-stored immutable ones', () => {
    expect(isCompletedSeason('2023', '2024')).toBe(true)
    expect(isCompletedSeason('2024', '2024')).toBe(false)
    const plan = planSync([mk('lg_a', '2023'), mk('lg_b', '2024'), mk('lg_c', '2022')], new Set(['lg_c']), '2024')
    const byRef = Object.fromEntries(plan.decisions.map((d) => [d.leagueReference, d.action]))
    expect(byRef['lg_c']).toBe('skip-immutable') // completed + already stored
    expect(byRef['lg_a']).toBe('import') // completed + not stored
    expect(byRef['lg_b']).toBe('refresh-current') // current season
    expect(plan.toImport.map((l) => l.leagueReference).sort()).toEqual(['lg_a', 'lg_b'])
    expect(plan.skippedCount).toBe(1)
  })
})

describe('integrityChecker', () => {
  it('flags broken chains, orphans, incomplete rosters, transaction inconsistency, and gaps', () => {
    const leagues: PersistedLeagueEvidence[] = [
      leagueEvidence({ leagueReference: 'lg_2024', season: '2024', previousLeagueRef: 'lg_missing' }), // broken chain
      leagueEvidence({
        leagueReference: 'lg_bad',
        season: '2022',
        facts: {
          leagueReference: 'lg_bad', season: '2022', sport: 'NFL', formatType: 'redraft', numTeams: 0,
          hasSuperflex: false, hasIdp: false, tightEndPremium: false, playoffTeams: 6, waiverType: 'FAAB',
          totalTrades: 5, totalWaiverClaims: 5, totalTransactions: 3, draftState: 'complete',
          sourceIsCommissioner: true, activeManagers: 0, inactiveManagers: 0,
        },
      }),
    ]
    const findings = checkEvidenceIntegrity(leagues, [
      { accountReference: 'acct_1', seasonsDiscovered: ['2024'], leagueRefs: ['lg_2024', 'lg_orphan'], updatedAt: 'now' },
    ])
    const codes = new Set(findings.map((f) => f.code))
    expect(codes.has('broken-league-chain')).toBe(true)
    // lg_bad is persisted but referenced by no portfolio → orphan-league
    expect(codes.has('orphan-league')).toBe(true)
    expect(codes.has('incomplete-roster')).toBe(true)
    expect(codes.has('transaction-inconsistency')).toBe(true) // 3 < 5+5
  })

  it('reports no findings for a clean corpus', () => {
    const clean = leagueEvidence({
      leagueReference: 'lg_ok', season: '2023', previousLeagueRef: null,
      facts: {
        leagueReference: 'lg_ok', season: '2023', sport: 'NFL', formatType: 'redraft', numTeams: 12,
        hasSuperflex: false, hasIdp: false, tightEndPremium: false, playoffTeams: 6, waiverType: 'FAAB',
        totalTrades: 3, totalWaiverClaims: 10, totalTransactions: 20, draftState: 'complete',
        sourceIsCommissioner: true, activeManagers: 12, inactiveManagers: 0,
      },
    })
    expect(checkEvidenceIntegrity([clean], [{ accountReference: 'a', seasonsDiscovered: ['2023'], leagueRefs: ['lg_ok'], updatedAt: 'now' }])).toEqual([])
  })
})

// End-to-end persist with injected fetch.
function fakeFetch(): SleeperFetch {
  return async <T>(url: string): Promise<T | null> => {
    if (url.endsWith('/user/alice')) return { user_id: 'u1', display_name: 'Alice' } as T
    if (url.includes('/user/u1/leagues/nfl/2024')) return [{ league_id: '2024a', season: '2024', sport: 'nfl', previous_league_id: '2023a' }] as T
    if (url.includes('/user/u1/leagues/nfl/2023')) return [{ league_id: '2023a', season: '2023', sport: 'nfl', previous_league_id: null }] as T
    if (url.includes('/users')) return [{ user_id: 'u1', is_owner: true }] as T
    if (url.includes('/rosters')) return Array.from({ length: 12 }, () => ({ owner_id: 'x' })) as T
    if (url.includes('/transactions/')) return [{ type: 'trade', status: 'complete' }] as T
    return null
  }
}

describe('persistPortfolio end-to-end (injected fetch + temp store)', () => {
  it('persists neutral evidence, tracks state, and is restartable (immutable imported once)', async () => {
    const store = new FileEvidenceStore(tmp)
    const opts = { seasons: ['2024', '2023'], currentSeason: '2024', maxTxWeeks: 2, concurrency: 2 }

    const r1 = await persistPortfolio(normalizeCohort(['alice']), fakeFetch(), store, opts)
    expect(r1.imported).toBe(2) // both seasons imported first run
    const leagues = await store.listLeagues()
    expect(leagues).toHaveLength(2)
    // no raw provider ids leaked into the store
    expect(JSON.stringify(leagues)).not.toMatch(/2024a|2023a|\bu1\b|sleeper/i)
    const state = await store.readImportState()
    expect(state.importedSeasons).toEqual(['2023', '2024'])
    expect(state.lastSuccessfulSync).toBeTruthy()

    // Second run: the 2023 completed season is immutable (skipped); 2024 current refreshes.
    const r2 = await persistPortfolio(normalizeCohort(['alice']), fakeFetch(), store, opts)
    expect(r2.skippedImmutable).toBe(1)
    expect(r2.imported).toBe(1)
  })

  it('persisted evidence feeds the existing Decision OS with no logic change (Part 6 compatibility)', async () => {
    const { probeLeague } = await import('@/lib/validation-cohort/decisionOsProbe')
    const store = new FileEvidenceStore(tmp)
    await persistPortfolio(normalizeCohort(['alice']), fakeFetch(), store, {
      seasons: ['2024'], currentSeason: '2024', maxTxWeeks: 2,
    })
    const [league] = await store.listLeagues()
    expect(league!.facts).toBeTruthy()
    // The stored provider-neutral facts are consumable by the existing probe unchanged.
    const { probes, health } = probeLeague(league!.facts!)
    expect(health).toBeTruthy()
    expect(probes.find((p) => p.output === 'league-health')!.reachability).toBe('available')
  })
})
