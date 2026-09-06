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

  /*
   * The success path emits TWO parity events, and both are legitimate — measured, not assumed:
   *   native    { legacy_shadow_compared, wrap_fidelity, evaluator_supported, parity_passed, … }
   *   canonical { shadow, surface: 'proposal', source: 'canonical_trade_world', ran, … }
   * `runCanonicalTradeShadowAttempt` runs BESIDE the native path inside `runTradeShadowForProposal`
   * and always emits exactly one event of its own. So these tests select the NATIVE event by
   * `legacy_shadow_compared`, the one flag canonical never sets. Asserting a total count here would
   * be asserting the canonical shadow's behaviour by accident.
   */
  const nativeParity = (events: { event: string; flags?: Record<string, unknown> }[]) =>
    events.filter((e) => e.event === 'decision.shadow_parity' && e.flags?.legacy_shadow_compared === true)

  it('a SUPPORTED run emits a native parity event carrying `ran`, so flipReadiness counts it', async () => {
    // Re-implements the gate's own predicate (`flags.ran === true`, flipReadiness.ts) rather than
    // asserting an event was emitted. Without `ran` the event falls to the skip branch under reason
    // 'unknown' — which is why this surface had produced zero countable comparisons.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runTradeShadowForProposal(baseArgs(), okDeps())
    const parity = nativeParity(events)
    expect(parity).toHaveLength(1)
    expect(parity[0]?.flags?.ran).toBe(true)
    expect(typeof parity[0]?.flags?.parity_passed).toBe('boolean')
  })

  it('an UNSUPPORTED (3+ team) run is a REFUSAL, not an agreement — ran:false with its reason', async () => {
    // 🛑 The whole trap of this fix. The legacy evaluator cannot evaluate a 3+ team trade, so NO
    // comparison happened. Blanket-adding `ran: true` to the success path would file that refusal as
    // a real comparison with no verdict, inflating the denominator the flip gate divides by.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    const res = await runTradeShadowForProposal({ ...baseArgs(), assets: fakeMultiTeamAssets() }, okDeps())
    expect(res.ran).toBe(true) // the SHADOW ran; the COMPARISON did not
    const parity = nativeParity(events)
    expect(parity).toHaveLength(1)
    expect(parity[0]?.flags?.ran).toBe(false)
    expect(parity[0]?.flags?.reason).toBe('unsupported_by_legacy_evaluator')
    expect(parity[0]?.flags?.parity_passed).toBeUndefined()
  })

  it('the native event carries a surface, and it is NOT the canonical shadow bucket', async () => {
    // `flipReadiness` groups on `flags.surface` with a literal 'default' fallback. This path and
    // `canonicalShadow` both run on the proposal route, but they are DIFFERENT strengths of evidence:
    // this one is fed the same persisted snapshot by design (wrap fidelity, tautological), while
    // canonical reads its own ADP. Sharing a bucket would let the weaker top up the stronger.
    const events: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runTradeShadowForProposal(baseArgs(), okDeps())
    const flags = nativeParity(events)[0]?.flags ?? {}
    const bucket = typeof flags.surface === 'string' && flags.surface ? flags.surface : 'default'
    expect(bucket).toBe('proposal_wrap_fidelity')
    expect(bucket).not.toBe('default')
    expect(bucket).not.toBe('proposal') // canonicalShadow's bucket, emitted on this same route
    expect(bucket).not.toBe('console')
  })

  it('moving the emit preserves every flag it carried, on BOTH branches', async () => {
    // The PRESERVATION half: green before and after. If this reddens, the move dropped something
    // rather than relocating it.
    const supported: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => supported.push(e as never))
    await runTradeShadowForProposal(baseArgs(), okDeps())
    const s = nativeParity(supported)[0]?.flags ?? {}
    expect(s.wrap_fidelity).toBe(true)
    expect(s.evaluator_supported).toBe(true)
    expect(s.parity_failed).toBe(false)
    expect(s.diffs).toBe(0)
    expect(s.participants).toBe(2)

    const unsupported: { event: string; flags?: Record<string, unknown> }[] = []
    registerDecisionTelemetrySink((e) => unsupported.push(e as never))
    await runTradeShadowForProposal({ ...baseArgs(), assets: fakeMultiTeamAssets() }, okDeps())
    const u = nativeParity(unsupported)[0]?.flags ?? {}
    expect(u.wrap_fidelity).toBe(true)
    expect(u.evaluator_supported).toBe(false)
    expect(u.unsupported).toBe(true)
    expect(u.participants).toBe(3)
  })
})
