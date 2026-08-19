import { describe, it, expect, afterEach } from 'vitest'
import { runTradeShadowForProposal, shouldRunTradeShadow } from '@/lib/decision-os/trade/shadow'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeWorldFacts, fakeProposal, fakeAssets, fakeMultiTeamAssets, fakeSnapshot, fakeDecisionDeps } from './tradeFakes'

afterEach(() => registerDecisionTelemetrySink(null))

const okDeps = (over = {}) => ({
  loadWorldFacts: async () => fakeWorldFacts(),
  buildDecisionDeps: (memo: ReturnType<typeof fakeSnapshot>) => fakeDecisionDeps({ evaluate: async () => memo }),
  ...over,
})

const baseArgs = (snapshotPayload: unknown = fakeSnapshot()) => ({
  userId: 'u1',
  leagueId: 'L1',
  seasonId: 'S1',
  proposal: fakeProposal(),
  assets: fakeAssets(),
  snapshotPayload,
})

describe('shouldRunTradeShadow (feature flag)', () => {
  it('true only when DECISION_OS_TRADE_SHADOW=true', () => {
    expect(shouldRunTradeShadow({ DECISION_OS_TRADE_SHADOW: 'true' } as never)).toBe(true)
    expect(shouldRunTradeShadow({ DECISION_OS_TRADE_SHADOW: 'TRUE' } as never)).toBe(true)
    expect(shouldRunTradeShadow({ DECISION_OS_TRADE_SHADOW: 'false' } as never)).toBe(false)
    expect(shouldRunTradeShadow({} as never)).toBe(false)
  })
})

describe('runTradeShadowForProposal — wrap-fidelity, never affecting legacy, never executing', () => {
  it('runs and parity PASSES when fed the same persisted snapshot (wrap fidelity)', async () => {
    const res = await runTradeShadowForProposal(baseArgs(fakeSnapshot()), okDeps())
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.result?.parity?.wrapFidelity).toBe(true)
  })

  it('parity FLAGS diffs when the Decision OS evaluation differs from the snapshot', async () => {
    const res = await runTradeShadowForProposal(baseArgs(fakeSnapshot()), okDeps({
      // decision evaluates a DIFFERENT grade than the snapshot passed to parity
      buildDecisionDeps: () => fakeDecisionDeps({ evaluate: async () => fakeSnapshot({ grade: { grade: 'D', valueDifference: 3000, fairnessScore: 40, confidenceScore: 90, bullets: [] } }) }),
    }))
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(false)
    expect(res.result?.parity?.diffs.length).toBeGreaterThan(0)
  })

  it('skips when the snapshot payload is missing/invalid (missing_snapshot)', async () => {
    const res = await runTradeShadowForProposal(baseArgs(null), okDeps())
    expect(res.ran).toBe(false)
    expect(res.error).toBe('missing_snapshot')
  })

  it('skips when world facts are unavailable (inputs_unavailable)', async () => {
    const res = await runTradeShadowForProposal(baseArgs(), okDeps({ loadWorldFacts: async () => null }))
    expect(res.ran).toBe(false)
    expect(res.error).toBe('inputs_unavailable')
  })

  it('NEVER throws when the loader throws (legacy stays safe)', async () => {
    const res = await runTradeShadowForProposal(baseArgs(), okDeps({ loadWorldFacts: async () => { throw new Error('db down') } }))
    expect(res.ran).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('does NOT mutate the snapshot payload (legacy response unchanged)', async () => {
    const snap = fakeSnapshot()
    const snapshot = snap
    const json = JSON.stringify(snapshot)
    await runTradeShadowForProposal(baseArgs(snapshot), okDeps())
    expect(JSON.stringify(snapshot)).toBe(json)
  })

  it('handles a 3+ team trade without crashing — runs, marks parity unsupported, emits unsupported telemetry', async () => {
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    const res = await runTradeShadowForProposal({ ...baseArgs(fakeSnapshot()), assets: fakeMultiTeamAssets() }, okDeps())
    expect(res.ran).toBe(true)
    expect(res.result?.decision.recommended_actions[0].evaluatorSupported).toBe(false)
    expect(res.result?.parity?.unsupported).toBe(true)
    expect(events.some((e) => e.event === 'decision.shadow_parity' && e.flags?.unsupported === true && e.flags?.evaluator_supported === false)).toBe(true)
  })

  it('emits split telemetry (decision.issued + decision.shadow_parity), not decision.parity', async () => {
    const events: { event: string }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runTradeShadowForProposal(baseArgs(), okDeps())
    expect(events.some((e) => e.event === 'decision.issued')).toBe(true)
    expect(events.some((e) => e.event === 'decision.shadow_parity')).toBe(true)
    expect(events.some((e) => (e.event as string) === 'decision.parity')).toBe(false)
  })
})
