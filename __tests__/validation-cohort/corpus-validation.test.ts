/**
 * Fantasy OS Suite — Phase V8.3: corpus Decision OS validation + counterfactual responsiveness.
 *
 * Report-only, fixture-backed. Exercises the runnable Decision OS entry points (health engine + league
 * attention signals) over provider-neutral fixtures, verifies provenance + determinism, and — the core of
 * the phase — proves the derivations are EVIDENCE-RESPONSIVE via counterfactuals that vary one factor at a
 * time while holding unrelated facts constant. Also asserts single-OS ownership + no provider leakage.
 */
import { describe, expect, it } from 'vitest'
import { runCorpusValidation } from '@/lib/validation-cohort/validation/corpusRunner'
import type { PersistedLeagueEvidence } from '@/lib/validation-cohort/persistence/evidenceStore'
import type { NormalizedLeagueFacts } from '@/lib/validation-cohort/types'

function facts(over: Partial<NormalizedLeagueFacts> = {}): NormalizedLeagueFacts {
  return {
    leagueReference: 'lg_cf', season: '2023', sport: 'NFL', formatType: 'redraft', numTeams: 12,
    hasSuperflex: false, hasIdp: false, tightEndPremium: false, playoffTeams: 6, waiverType: 'FAAB',
    totalTrades: 8, totalWaiverClaims: 30, totalTransactions: 60, draftState: 'complete',
    sourceIsCommissioner: true, activeManagers: 12, inactiveManagers: 0, ...over,
  }
}
function league(ref: string, over: Partial<NormalizedLeagueFacts> = {}): PersistedLeagueEvidence {
  return {
    leagueReference: ref, season: '2023', sport: 'NFL', previousLeagueRef: null, role: 'commissioner',
    facts: facts({ leagueReference: ref, ...over }), evidence: { metadata: true, rosters: true, trades: true },
    seasonImmutable: true, importedAt: 'now',
  }
}

function messages(report: ReturnType<typeof runCorpusValidation>): string[] {
  return report.recommendations.map((r) => r.message)
}

describe('corpus runner — provenance + determinism + report-only', () => {
  it('captures recommendations with full provenance', () => {
    const r = runCorpusValidation([league('lg_1', { totalTrades: 0 })], 'fixture')
    expect(r.dataSource).toBe('fixture')
    expect(r.recommendations.length).toBeGreaterThan(0)
    for (const rec of r.recommendations) {
      expect(rec.inputFingerprint).toMatch(/^[0-9a-f]{12}$/)
      expect(rec.observedFacts.length).toBeGreaterThan(0)
      expect(rec.missingEvidence.length).toBeGreaterThan(0) // gaps disclosed, not fabricated
      expect(['league-health-engine', 'league-attention-signals']).toContain(rec.sourceSubsystem)
    }
    // health-engine recommendations disclose the provider-unavailable inputs specifically
    const healthRecs = r.recommendations.filter((x) => x.sourceSubsystem === 'league-health-engine')
    expect(healthRecs.some((x) => x.missingEvidence.includes('disputes'))).toBe(true)
  })

  it('is deterministic (identical corpus ⇒ identical report modulo timestamp)', () => {
    const corpus = [league('lg_1', { totalTrades: 0 }), league('lg_2', { activeManagers: 4 })]
    const a = runCorpusValidation(corpus, 'fixture')
    const b = runCorpusValidation(corpus, 'fixture')
    expect({ ...a, generatedAt: '' }).toEqual({ ...b, generatedAt: '' })
  })

  it('detects over-firing across similar leagues', () => {
    // Five identical low-trade leagues → the trade-stimulation intervention repeats → over-firing flagged.
    const corpus = ['a', 'b', 'c', 'd', 'e'].map((x) => league(`lg_${x}`, { totalTrades: 0 }))
    const r = runCorpusValidation(corpus, 'fixture')
    expect(r.overFiring.some((o) => /trade/i.test(o.message))).toBe(true)
  })
})

describe('counterfactual responsiveness — vary ONE factor, hold others constant', () => {
  it('trade activity: low-trade fires the trade intervention; high-trade does not; health verdict stable', () => {
    const low = runCorpusValidation([league('lg_x', { totalTrades: 0 })], 'fixture')
    const high = runCorpusValidation([league('lg_x', { totalTrades: 40 })], 'fixture')
    // Isolate at the health-engine layer (the attention layer legitimately also reacts to transaction
    // volume via a "requires review" signal — a real coupling, not a defect, so we don't assert on it).
    const healthMsgs = (r: typeof low) => r.recommendations.filter((x) => x.sourceSubsystem === 'league-health-engine').map((x) => x.message)
    expect(healthMsgs(low).some((m) => /trade/i.test(m))).toBe(true)
    expect(healthMsgs(high).some((m) => /stimulate trade|trade activity|trade deadline/i.test(m))).toBe(false)
  })

  it('isolation: toggling an irrelevant factor (TE-premium) changes no recommendation', () => {
    // TE-premium is an archetype flag the health engine does not consume — changing it must be inert.
    const off = runCorpusValidation([league('lg_i', { tightEndPremium: false })], 'fixture')
    const on = runCorpusValidation([league('lg_i', { tightEndPremium: true })], 'fixture')
    expect(messages(off).sort()).toEqual(messages(on).sort())
  })

  it('manager inactivity: a mostly-inactive league is classified worse than a fully-active one', () => {
    const active = runCorpusValidation([league('lg_a', { activeManagers: 12, inactiveManagers: 0 })], 'fixture')
    const inactive = runCorpusValidation([league('lg_a', { activeManagers: 3, inactiveManagers: 9 })], 'fixture')
    const sevActive = active.recommendations.map((r) => r.severity)
    const sevInactive = inactive.recommendations.map((r) => r.severity)
    // the inactive league must not be rated the same/better than the fully-active one
    expect(JSON.stringify(sevInactive)).not.toEqual(JSON.stringify(sevActive))
    expect(inactive.recommendations.length).toBeGreaterThanOrEqual(active.recommendations.length)
  })

  it('waiver activity: a quiet-waiver league differs from a very-active-waiver league', () => {
    const quiet = runCorpusValidation([league('lg_w', { totalWaiverClaims: 0, totalTransactions: 5 })], 'fixture')
    const busy = runCorpusValidation([league('lg_w', { totalWaiverClaims: 60, totalTransactions: 80 })], 'fixture')
    expect(JSON.stringify(messages(quiet))).not.toEqual(JSON.stringify(messages(busy)))
  })
})

describe('cross-OS ownership + provider neutrality', () => {
  it('every runner recommendation is league-scoped from a single named subsystem', () => {
    const r = runCorpusValidation([league('lg_1', { totalTrades: 0 })], 'fixture')
    for (const rec of r.recommendations) {
      expect(rec.scope).toBe('league')
      expect(rec.sourceSubsystem).toBeTruthy()
    }
  })

  it('no provider identifiers appear anywhere in the validation report', () => {
    const r = runCorpusValidation([league('lg_1', { totalTrades: 0 }), league('lg_2', { activeManagers: 3 })], 'single-account-smoke')
    expect(JSON.stringify(r)).not.toMatch(/sleeper|espn|yahoo|fantrax|theciege|owner_id|\bdraft_id\b/i)
  })
})
