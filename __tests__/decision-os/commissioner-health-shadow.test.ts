import { describe, it, expect, afterEach } from 'vitest'
import { runCommissionerHealthShadow, shouldRunCommissionerHealthShadow } from '@/lib/decision-os/commissioner-health/shadow'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeSnapshot, fakeDecisionDeps } from './commissionerHealthFakes'

afterEach(() => registerDecisionTelemetrySink(null))

const okDeps = (over = {}) => ({
  buildDecisionDeps: (memo: ReturnType<typeof fakeSnapshot>) => fakeDecisionDeps({ evaluate: async () => memo }),
  ...over,
})

describe('shouldRunCommissionerHealthShadow (feature flag)', () => {
  it('true only when DECISION_OS_COMMISSIONER_HEALTH_SHADOW=true', () => {
    expect(shouldRunCommissionerHealthShadow({ DECISION_OS_COMMISSIONER_HEALTH_SHADOW: 'true' } as never)).toBe(true)
    expect(shouldRunCommissionerHealthShadow({ DECISION_OS_COMMISSIONER_HEALTH_SHADOW: 'TRUE' } as never)).toBe(true)
    expect(shouldRunCommissionerHealthShadow({ DECISION_OS_COMMISSIONER_HEALTH_SHADOW: 'false' } as never)).toBe(false)
    expect(shouldRunCommissionerHealthShadow({} as never)).toBe(false)
  })

  it('honors scoped test usernames and league ids', () => {
    const env = {
      DECISION_OS_COMMISSIONER_HEALTH_SHADOW: 'true',
      DECISION_OS_TEST_USERNAMES: 'theciege24',
      DECISION_OS_TEST_LEAGUE_IDS: 'L1',
    } as never

    expect(shouldRunCommissionerHealthShadow(env, { username: 'theciege24', leagueId: 'L1' })).toBe(true)
    expect(shouldRunCommissionerHealthShadow(env, { username: 'other-user', leagueId: 'L1' })).toBe(false)
  })
})

describe('runCommissionerHealthShadow — wrap-fidelity, never affecting the hub, never executing', () => {
  it('runs and parity PASSES when fed the same built snapshot (wrap fidelity)', async () => {
    const res = await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps())
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.result?.parity?.wrapFidelity).toBe(true)
    expect(res.result?.decision.decider_scope).toBe('commissioner')
  })

  it('parity FLAGS diffs when the Decision OS assessment differs from the snapshot', async () => {
    const res = await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps({
      buildDecisionDeps: () => fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ healthScore: 12, overallStatus: 'critical', engagementScore: 10 }) }),
    }))
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(false)
    expect(res.result?.parity?.diffs.length).toBeGreaterThan(0)
  })

  it('SKIPS the dashboard-fallback path (non-authoritative)', async () => {
    const res = await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot({ source: 'dashboard-fallback' }) }, okDeps())
    expect(res.ran).toBe(false)
    expect(res.error).toBe('fallback_or_missing_snapshot')
  })

  it('NEVER throws when the decision path throws (hub stays safe)', async () => {
    const res = await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps({
      buildDecisionDeps: () => fakeDecisionDeps({ evaluate: async () => { throw new Error('boom') } }),
    }))
    expect(res.ran).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('does NOT mutate the snapshot (returned hub snapshot unchanged)', async () => {
    const snap = fakeSnapshot()
    const json = JSON.stringify(snap)
    await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: snap }, okDeps())
    expect(JSON.stringify(snap)).toBe(json)
  })

  it('emits split telemetry (decision.issued + decision.shadow_parity), not decision.parity', async () => {
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps())
    expect(events.some((e) => e.event === 'decision.issued')).toBe(true)
    expect(events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.decider_scope === 'commissioner')).toBe(true)
    expect(events.some((e) => (e.event as string) === 'decision.parity')).toBe(false)
  })

  it('the success-path parity event carries `ran`, so flipReadiness counts it as a COMPARISON', async () => {
    // Deliberately re-implements the gate's own predicate (`flags.ran === true`, flipReadiness.ts)
    // rather than asserting "an event was emitted". Without `ran` the event falls to the skip branch
    // under reason 'unknown' and the surface can never reach the gate at any volume — which is how
    // all 80 of this surface's production rows became uncountable.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps())
    const parity = events.filter((e) => e.event === 'decision.shadow_parity')
    expect(parity).toHaveLength(1)
    expect(parity[0]?.flags?.ran).toBe(true)
    expect(typeof parity[0]?.flags?.parity_passed).toBe('boolean')
  })

  it('moving the emit preserves every flag it carried (verdict, scope, provenance)', async () => {
    // The PRESERVATION half of the control: this passes before and after, so if it ever goes red the
    // move dropped something. A control that only asserted the new `ran` flag could not tell the
    // difference between relocating the emit and replacing it with a thinner one.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot() }, okDeps())
    const flags = events.find((e) => e.event === 'decision.shadow_parity')?.flags ?? {}
    expect(flags.decider_scope).toBe('commissioner')
    expect(flags.wrap_fidelity).toBe(true)
    expect(flags.parity_passed).toBe(true)
    expect(flags.parity_failed).toBe(false)
    expect(flags.diffs).toBe(0)
    expect(flags.userId).toBe('commish-1')
    expect(flags.leagueId).toBe(fakeSnapshot().leagueId)
  })

  it('a SKIPPED run still emits exactly one parity event, and it is not a comparison', async () => {
    // The skip paths already carried `ran: false`. Pinning it here stops a future "just add ran:true
    // everywhere" from turning refusals into agreements — the failure this whole area is prone to.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runCommissionerHealthShadow({ userId: 'commish-1', snapshot: fakeSnapshot({ source: 'dashboard-fallback' }) }, okDeps())
    const parity = events.filter((e) => e.event === 'decision.shadow_parity')
    expect(parity).toHaveLength(1)
    expect(parity[0]?.flags?.ran).toBe(false)
    expect(parity[0]?.flags?.reason).toBe('fallback_or_missing_snapshot')
  })
})
