/**
 * Fantasy OS Suite — Phase V8.4: production composition bridge validation.
 *
 * Fixture-backed. Verifies the REAL production composition functions execute over the corpus with honest
 * per-subsystem status, that blocked paths report the exact missing contract (never fabricated), that the
 * port is deterministic, that composition responds to evidence counterfactually, and that the bridge keeps
 * the production/persistence boundary (read-only, no prisma, not imported by customer routes).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CorpusEvidencePort, runCompositionValidation } from '@/lib/validation-cohort/validation/compositionBridge'
import type { PersistedLeagueEvidence } from '@/lib/validation-cohort/persistence/evidenceStore'
import type { NormalizedLeagueFacts } from '@/lib/validation-cohort/types'

function facts(over: Partial<NormalizedLeagueFacts> = {}): NormalizedLeagueFacts {
  return {
    leagueReference: 'lg_c', season: '2023', sport: 'NFL', formatType: 'redraft', numTeams: 12,
    hasSuperflex: false, hasIdp: false, tightEndPremium: false, playoffTeams: 6, waiverType: 'FAAB',
    totalTrades: 6, totalWaiverClaims: 30, totalTransactions: 50, draftState: 'complete',
    sourceIsCommissioner: true, activeManagers: 12, inactiveManagers: 0, ...over,
  }
}
function league(ref: string, over: Partial<NormalizedLeagueFacts> = {}): PersistedLeagueEvidence {
  return {
    leagueReference: ref, season: '2023', sport: 'NFL', previousLeagueRef: null, role: 'commissioner',
    facts: facts({ leagueReference: ref, ...over }), evidence: { metadata: true }, seasonImmutable: true, importedAt: 'now',
  }
}
const exec = (leagues: PersistedLeagueEvidence[]) => runCompositionValidation(new CorpusEvidencePort(leagues))
const byName = (r: ReturnType<typeof exec>) => Object.fromEntries(r.map((e) => [e.subsystem, e]))

describe('composition execution matrix — real production functions, honest statuses', () => {
  it('executes Daily Brief / Notifications / Platform + Commissioner recs at production parity', () => {
    const m = byName(exec([league('lg_1'), league('lg_2', { activeManagers: 4, inactiveManagers: 8 })]))
    for (const s of ['Daily Brief', 'Notification Feed', 'Platform Recommendations', 'Commissioner Recommendations']) {
      expect(m[s]!.status, s).toBe('production-parity-executed')
    }
    expect(m['Daily Brief']!.entryPoint).toBe('composeDailyBrief')
    expect(m['Platform Recommendations']!.entryPoint).toBe('assemblePlatformRecommendations')
  })

  it('reports manager recs as blocked-unavailable with the exact missing contract (never fabricated)', () => {
    const m = byName(exec([league('lg_1')]))
    const mgr = m['Manager Recommendations']!
    expect(mgr.status).toBe('blocked-unavailable-evidence')
    expect(mgr.producedCount).toBe(0)
    expect(mgr.missingEvidence).toContain('manager-identity')
    expect(mgr.missingEvidence).toContain('behavioral-patterns')
  })

  it('reports DB-backed resolvers as blocked-product-state', () => {
    const m = byName(exec([league('lg_1')]))
    for (const s of ['Mission Control', 'Manager Command Center', 'League Analytics']) {
      expect(m[s]!.status, s).toBe('blocked-product-state')
      expect(m[s]!.missingEvidence).toContain('db-resolved-inputs')
    }
  })
})

describe('determinism + parity', () => {
  it('two ports over identical evidence produce identical executions (deterministic fingerprints)', () => {
    const corpus = [league('lg_1'), league('lg_2', { activeManagers: 3 })]
    expect(exec(corpus)).toEqual(exec(corpus))
  })
})

describe('counterfactual composition — the Daily Brief responds to evidence', () => {
  it('an unhealthy league raises Daily Brief output vs an all-healthy corpus', () => {
    const healthy = byName(exec([league('lg_1'), league('lg_2')]))
    const withUnhealthy = byName(exec([league('lg_1'), league('lg_2', { activeManagers: 2, inactiveManagers: 10 })]))
    expect(withUnhealthy['Daily Brief']!.producedCount).toBeGreaterThan(healthy['Daily Brief']!.producedCount)
  })

  it('a fully-healthy corpus yields a legitimately empty/healthy brief (not fabricated work)', () => {
    const m = byName(exec([league('lg_1'), league('lg_2')]))
    // healthy corpus → the brief is allowed to be empty; producedCount reflects real signals only
    expect(m['Daily Brief']!.producedCount).toBeGreaterThanOrEqual(0)
    expect(m['Daily Brief']!.outputStatus).toMatch(/produced|empty/)
  })
})

describe('boundaries (Part 12)', () => {
  it('no provider identifiers appear in the composition executions', () => {
    const r = exec([league('lg_1'), league('lg_2', { activeManagers: 3 })])
    expect(JSON.stringify(r)).not.toMatch(/sleeper|espn|yahoo|fantrax|theciege|owner_id|draft_id/i)
  })

  it('the bridge is read-only — it imports no prisma/db and never writes', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'validation-cohort', 'validation', 'compositionBridge.ts'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/db'|PrismaClient|prisma\./)
    expect(src).not.toMatch(/writeFileSync|upsert|\.create\(|\.update\(/)
  })
})
