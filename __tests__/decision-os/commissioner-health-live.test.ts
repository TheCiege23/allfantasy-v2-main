import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { shouldRunCommissionerHealthLive } from '@/lib/decision-os/commissioner-health/shadow'

/**
 * Stage 1 source-contract + flag-gate tests for the Commissioner LIVE kill switch.
 *
 * Two concerns:
 * 1. `shouldRunCommissionerHealthLive` gate — unit tested here (no DB).
 * 2. LIVE wiring in commissionerHubHealth.ts — source-contract tested by reading the file.
 *    The full hub function has too many DB deps for a cheap unit test; the shadow runner's
 *    behaviour is tested in commissioner-health-shadow.test.ts.
 */
const hubSrc = readFileSync(
  resolve(process.cwd(), 'lib/commissioner-hub/commissionerHubHealth.ts'),
  'utf8',
)

  // Windows widened from 400-1000 to 2600: the batched `leaguesWithSavedAnalysis` prefilter
  // added lines at the head of the LIVE block, pushing every asserted token past the old spans
  // (furthest is now 2374). All of these are CONTAINMENT checks -- does the block mention X -- so a
  // wider window still tests the same thing. Contrast live-telemetry.test.ts, where three 300-char
  // windows are PROXIMITY checks and widening would delete what they assert.
describe('shouldRunCommissionerHealthLive (Stage 1 kill switch)', () => {
  it('true only when DECISION_OS_COMMISSIONER_HEALTH_LIVE=true', () => {
    expect(shouldRunCommissionerHealthLive({ DECISION_OS_COMMISSIONER_HEALTH_LIVE: 'true' } as never)).toBe(true)
    expect(shouldRunCommissionerHealthLive({ DECISION_OS_COMMISSIONER_HEALTH_LIVE: 'TRUE' } as never)).toBe(true)
    expect(shouldRunCommissionerHealthLive({ DECISION_OS_COMMISSIONER_HEALTH_LIVE: 'false' } as never)).toBe(false)
    expect(shouldRunCommissionerHealthLive({} as never)).toBe(false)
  })

  it('kill switch: returns false when env var is unset (instant rollback path)', () => {
    expect(shouldRunCommissionerHealthLive({} as never)).toBe(false)
  })

  it('does not accept the shadow env var as live (flags are independent)', () => {
    expect(shouldRunCommissionerHealthLive({ DECISION_OS_COMMISSIONER_HEALTH_SHADOW: 'true' } as never)).toBe(false)
  })

  it('is not scope-filtered — live is unconditional, no username/league gates', () => {
    // shouldRunCommissionerHealthLive has no scope parameter; it's a simple boolean flag.
    // When live=true, all database-source leagues are enriched.
    expect(typeof shouldRunCommissionerHealthLive).toBe('function')
    expect(shouldRunCommissionerHealthLive.length).toBeLessThanOrEqual(1) // only env param
  })
})

describe('commissioner-hub Stage 1 wiring: commissionerHubHealth.ts', () => {
  it('imports shouldRunCommissionerHealthLive from the shadow module', () => {
    expect(hubSrc).toContain('shouldRunCommissionerHealthLive')
    expect(hubSrc).toContain("from '@/lib/decision-os/commissioner-health/shadow'")
  })

  it('gates the LIVE path with shouldRunCommissionerHealthLive(process.env)', () => {
    expect(hubSrc).toMatch(/shouldRunCommissionerHealthLive\(process\.env\)/)
  })

  it('LIVE path populates decisionOsShadow using runCommissionerHealthShadow', () => {
    const liveIdx = hubSrc.indexOf('shouldRunCommissionerHealthLive(process.env)')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = hubSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toContain('runCommissionerHealthShadow')
    expect(liveBlock).toContain('decisionOsShadow:')
  })

  it('LIVE path is isolated in try/catch so the hub never breaks', () => {
    const liveIdx = hubSrc.indexOf('shouldRunCommissionerHealthLive(process.env)')
    expect(liveIdx).toBeGreaterThan(-1)
    const liveBlock = hubSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toMatch(/try\s*\{/)
    expect(liveBlock).toMatch(/catch/)
  })

  it('LIVE mode skips dashboard-fallback snapshots (source !== database guard)', () => {
    const liveIdx = hubSrc.indexOf('shouldRunCommissionerHealthLive(process.env)')
    expect(liveIdx).toBeGreaterThan(-1)
    // The live block guards against non-database snapshots before running the shadow
    const liveBlock = hubSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toMatch(/source.*!==.*database/)
  })

  it('Stage 0 shadow path still exists in else branch (shadow mode preserved)', () => {
    expect(hubSrc).toContain('shouldRunCommissionerHealthShadow(process.env')
  })

  it('legacy fields are preserved regardless of live mode (healthScore / overallStatus / actions)', () => {
    expect(hubSrc).toContain('healthScore:')
    expect(hubSrc).toContain('overallStatus:')
    expect(hubSrc).toContain('buildActions(')
  })

  it('decisionOsShadow field shape matches CommissionerLeagueHealthSnapshot type', () => {
    // All three required sub-fields must be populated in the live block
    const liveIdx = hubSrc.indexOf('shouldRunCommissionerHealthLive(process.env)')
    const liveBlock = hubSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toContain('decisionId:')
    expect(liveBlock).toContain('parityPassed:')
    expect(liveBlock).toContain('card:')
  })

  it('LIVE path uses Promise.all for parallel snapshot enrichment', () => {
    const liveIdx = hubSrc.indexOf('shouldRunCommissionerHealthLive(process.env)')
    const liveBlock = hubSrc.slice(liveIdx, liveIdx + 2600)
    expect(liveBlock).toContain('Promise.all')
  })
})
