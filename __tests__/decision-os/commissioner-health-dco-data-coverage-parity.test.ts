/**
 * Parity coverage for lib/decision-os/commissioner-health/dco.ts's NFL
 * data-coverage uncertainty push.
 *
 * dco.ts used to hardcode `String(w.sport).toUpperCase() === 'NFL'`. It now
 * resolves a SportAdapter via `resolveSportAdapter()` (lib/decision-os-core)
 * and checks `tracksProviderDataCoverage` instead. These tests prove the
 * observable behavior is byte-identical to the old string check for every
 * input that mattered before this change — see
 * docs/DECISION_OS_CORE_UNIFICATION_PLAN.md and
 * docs/DECISION_OS_CORE_PHASE1_IMPLEMENTATION_NOTE.md.
 */
import { describe, it, expect } from 'vitest'
import { buildCommissionerHealthDCO } from '@/lib/decision-os/commissioner-health/dco'
import { resolveCommissionerHealthWorld } from '@/lib/decision-os/commissioner-health/world'
import { fakeSnapshot } from './commissionerHealthFakes'

const NFL_UNCERTAINTY_MESSAGE = 'NFL data coverage could not be verified.'

const dco = (over: Parameters<typeof fakeSnapshot>[0] = {}) =>
  buildCommissionerHealthDCO({
    world: resolveCommissionerHealthWorld({ snapshot: fakeSnapshot(over) }),
    userId: 'commish-1',
  })

describe('commissioner-health DCO — NFL data coverage uncertainty (parity)', () => {
  it('NFL + unknown coverage (nflDataCoverage: null) → pushes the NFL uncertainty message', () => {
    const d = dco({ sport: 'NFL', nflDataCoverage: null })
    expect(d.uncertainty).toContain(NFL_UNCERTAINTY_MESSAGE)
  })

  it('NFL + known coverage (nflDataCoverage populated) → does NOT push the message', () => {
    const d = dco({ sport: 'NFL', nflDataCoverage: { missingFields: [], staleFields: [] } as any })
    expect(d.uncertainty).not.toContain(NFL_UNCERTAINTY_MESSAGE)
  })

  it('lowercase/mixed-case "nfl" sport string still triggers the message (case-insensitivity preserved)', () => {
    expect(dco({ sport: 'nfl', nflDataCoverage: null }).uncertainty).toContain(NFL_UNCERTAINTY_MESSAGE)
    expect(dco({ sport: 'Nfl', nflDataCoverage: null }).uncertainty).toContain(NFL_UNCERTAINTY_MESSAGE)
  })

  it.each(['NCAAF', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER'])(
    'non-NFL sport %s + unknown coverage → does NOT push the message (unaffected, matches old behavior)',
    (sport) => {
      const d = dco({ sport, nflDataCoverage: null })
      expect(d.uncertainty).not.toContain(NFL_UNCERTAINTY_MESSAGE)
    },
  )

  it('unknown/unsupported sport string + unknown coverage → does NOT push the message, does not throw', () => {
    expect(() => dco({ sport: 'KORFBALL', nflDataCoverage: null })).not.toThrow()
    expect(dco({ sport: 'KORFBALL', nflDataCoverage: null }).uncertainty).not.toContain(NFL_UNCERTAINTY_MESSAGE)
  })

  it('world-level uncertainty (e.g. dashboard-fallback) still composes independently of the NFL message', () => {
    const d = dco({ sport: 'NFL', nflDataCoverage: null, source: 'dashboard-fallback', dataConfidence: 'low' })
    expect(d.uncertainty).toContain(NFL_UNCERTAINTY_MESSAGE)
    expect(d.uncertainty.some((u) => u.includes('dashboard-fallback'))).toBe(true)
  })
})
