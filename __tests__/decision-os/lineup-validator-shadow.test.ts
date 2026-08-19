import { describe, it, expect, afterEach } from 'vitest'
import { runLineupShadow } from '@/lib/decision-os/lineup/shadow'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import type { RunLineupSetInput } from '@/lib/decision-os/lineup'
import type { LineupRuleContext } from '@/lib/decision-os/lineup/rules'
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import { fakeValidate, payload, action } from './lineupFakes'

/**
 * Ticket #6 — canonical validator shadow integration. The shadow runs validator parity (primary vs
 * canonical) BESIDE the legacy path, never affecting it. The decision's active gate stays primary.
 */
const input = (leagueId = 'L1'): RunLineupSetInput => ({
  sport: 'NFL',
  leagueSettings: {},
  leagueWeek: 1,
  editingWeek: 1,
  userId: 'u1',
  leagueId,
  rosterId: 'r1',
  players: [{ playerId: 'p1', playerName: 'QB One', position: 'QB', sport: 'NFL', slotType: 'QB' }] as RunLineupSetInput['players'],
})

const fakeCtx = {} as LineupValidationContext
const loadCtx = async () => fakeCtx
// A canonical dep that flags a canonical-ONLY category → complementary coverage, retirement NOT safe.
const complementaryCanonicalDep = () => (_ruleCtx: LineupRuleContext): RuleVerdict[] => [
  { rule: 'lineup.canonical.ir_ineligible_status', verdict: 'illegal', message: 'ir', severity: 'critical' },
]

afterEach(() => registerDecisionTelemetrySink(null))

describe('shadow canonical validator parity — Ticket #6', () => {
  it('loads the canonical context at the seam and runs validator parity (retirement NOT safe = complementary)', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      {
        loadInputs: async () => input('L1'),
        ruleDeps: { validateRedraft: fakeValidate() },
        loadCanonicalContext: loadCtx,
        buildCanonicalDep: complementaryCanonicalDep,
      },
    )
    expect(res.ran).toBe(true)
    expect(res.validatorParity).toBeDefined()
    expect(res.validatorParity?.agreeOnSharedScope).toBe(true)
    expect(res.validatorParity?.retirementSafe).toBe(false)
    expect(res.validatorParity?.reason).toBe('complementary_coverage')
  })

  it('emits validator_parity telemetry (ran + retirement_safe:false)', async () => {
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: fakeValidate() }, loadCanonicalContext: loadCtx, buildCanonicalDep: complementaryCanonicalDep },
    )
    const ev = events.find((e) => e.event === 'decision.validator_parity' && e.flags?.validator_parity_ran === true)
    expect(ev).toBeDefined()
    expect(ev?.flags?.validator_retirement_safe).toBe(false)
    expect(ev?.flags?.validator_parity_shared_agreement).toBe(true)
    expect(ev?.flags?.validator_parity_reason).toBe('complementary_coverage')
  })

  it('SURVIVES a canonical validator that throws — no throw, legacy parity unaffected, error recorded', async () => {
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      {
        loadInputs: async () => input('L1'),
        ruleDeps: { validateRedraft: fakeValidate() },
        loadCanonicalContext: loadCtx,
        buildCanonicalDep: () => () => { throw new Error('canonical boom') },
      },
    )
    // legacy/decision parity still ran fine
    expect(res.ran).toBe(true)
    expect(res.parity?.passed).toBe(true)
    // validator parity captured the canonical error rather than throwing
    expect(res.validatorParity?.reason).toBe('canonical_validator_error')
    expect(res.validatorParity?.retirementSafe).toBe(false)
    const ev = events.find((e) => e.event === 'decision.validator_parity' && e.flags?.validator_parity_ran === true)
    expect(ev?.flags?.canonical_validator_error).toBeTruthy()
  })

  it('skips validator parity gracefully when the canonical context is unavailable (null)', async () => {
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      {
        loadInputs: async () => input('L1'),
        ruleDeps: { validateRedraft: fakeValidate() },
        loadCanonicalContext: async () => null,
        buildCanonicalDep: complementaryCanonicalDep,
      },
    )
    expect(res.ran).toBe(true)
    expect(res.parity?.passed).toBe(true)
    expect(res.validatorParity).toBeUndefined()
    expect(events.some((e) => e.event === 'decision.validator_parity' && e.flags?.validator_parity_ran === false && e.flags?.reason === 'canonical_context_unavailable')).toBe(true)
  })

  it('NEVER throws when the canonical context LOADER throws (decision/legacy still fine)', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      {
        loadInputs: async () => input('L1'),
        ruleDeps: { validateRedraft: fakeValidate() },
        loadCanonicalContext: async () => { throw new Error('context db down') },
        buildCanonicalDep: complementaryCanonicalDep,
      },
    )
    expect(res.ran).toBe(true)
    expect(res.parity?.passed).toBe(true)
    expect(res.validatorParity).toBeUndefined()
  })

  it('does NOT mutate the legacy summary (legacy response unchanged)', async () => {
    const legacy = payload('L1', [action('L1')])
    const snapshot = JSON.stringify(legacy)
    await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: legacy },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: fakeValidate() }, loadCanonicalContext: loadCtx, buildCanonicalDep: complementaryCanonicalDep },
    )
    expect(JSON.stringify(legacy)).toBe(snapshot)
  })

  it('runs without a canonical loader (back-compat: validator parity simply skipped)', async () => {
    const res = await runLineupShadow(
      { userId: 'u1', leagueId: 'L1', legacySummary: payload('L1', [action('L1')]) },
      { loadInputs: async () => input('L1'), ruleDeps: { validateRedraft: fakeValidate() }, loadCanonicalContext: undefined, buildCanonicalDep: undefined },
    )
    expect(res.ran).toBe(true)
    expect(res.validatorParity).toBeUndefined()
  })
})
