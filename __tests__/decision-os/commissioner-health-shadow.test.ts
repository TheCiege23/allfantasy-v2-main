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
})
