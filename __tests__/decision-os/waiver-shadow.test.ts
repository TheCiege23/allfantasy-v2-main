import { describe, it, expect, afterEach } from 'vitest'
import { runWaiverShadowForEngine, shouldRunWaiverShadow } from '@/lib/decision-os/waiver/shadow'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { fakeWorldFacts, fakeEngineInput, fakeAnalysis, fakeSuggestion, fakeDecisionDeps } from './waiverFakes'

afterEach(() => registerDecisionTelemetrySink(null))

const okDeps = (over = {}) => ({
  loadWorldFacts: async () => fakeWorldFacts(),
  buildDecisionDeps: (_f: unknown, memo: ReturnType<typeof fakeAnalysis>) => fakeDecisionDeps({ recommend: async () => memo }),
  ...over,
})

describe('shouldRunWaiverShadow (feature flag)', () => {
  it('true only when DECISION_OS_WAIVER_SHADOW=true', () => {
    expect(shouldRunWaiverShadow({ DECISION_OS_WAIVER_SHADOW: 'true' } as never)).toBe(true)
    expect(shouldRunWaiverShadow({ DECISION_OS_WAIVER_SHADOW: 'TRUE' } as never)).toBe(true)
    expect(shouldRunWaiverShadow({ DECISION_OS_WAIVER_SHADOW: 'false' } as never)).toBe(false)
    expect(shouldRunWaiverShadow({} as never)).toBe(false)
  })

  it('honors scoped league targeting', () => {
    const env = {
      DECISION_OS_WAIVER_SHADOW: 'true',
      DECISION_OS_TEST_LEAGUE_IDS: 'L1',
    } as never

    expect(shouldRunWaiverShadow(env, { leagueId: 'L1' })).toBe(true)
    expect(shouldRunWaiverShadow(env, { leagueId: 'L2' })).toBe(false)
  })
})

describe('runWaiverShadowForEngine — beside legacy, wrap-fidelity parity, never affecting it', () => {
  it('runs and parity PASSES when fed the same deterministic suggestions (wrap fidelity)', async () => {
    const legacy = fakeAnalysis([fakeSuggestion()])
    const res = await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: legacy },
      okDeps(),
    )
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(true)
    expect(res.result?.parity?.wrapFidelity).toBe(true)
  })

  it('parity FLAGS diffs when the Decision OS recommendation differs from legacy suggestions', async () => {
    const legacy = fakeAnalysis([fakeSuggestion({ playerId: 'wp1' })])
    const res = await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: legacy },
      okDeps({
        // decision recommends a DIFFERENT player than the legacy suggestions passed to parity
        buildDecisionDeps: () => fakeDecisionDeps({ recommend: async () => fakeAnalysis([fakeSuggestion({ playerId: 'wpX', playerName: 'Different' })]) }),
      }),
    )
    expect(res.ran).toBe(true)
    expect(res.result?.parity?.passed).toBe(false)
    expect(res.result?.parity?.diffs.length).toBeGreaterThan(0)
  })

  it('the optional AI explanation is ignored for parity (det vs ai prose still passes)', async () => {
    const legacy = fakeAnalysis([fakeSuggestion()], 'ai')
    const res = await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: legacy },
      okDeps(),
    )
    expect(res.result?.parity?.passed).toBe(true)
  })

  it('skips gracefully when world facts are unavailable (non-member / missing roster)', async () => {
    const res = await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: fakeAnalysis() },
      okDeps({ loadWorldFacts: async () => null }),
    )
    expect(res.ran).toBe(false)
    expect(res.error).toBe('inputs_unavailable')
  })

  it('NEVER throws when the loader throws (legacy stays safe)', async () => {
    const res = await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: fakeAnalysis() },
      okDeps({ loadWorldFacts: async () => { throw new Error('db down') } }),
    )
    expect(res.ran).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('does NOT mutate the legacy analysis (legacy response unchanged)', async () => {
    const legacy = fakeAnalysis([fakeSuggestion()])
    const snapshot = JSON.stringify(legacy)
    await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: legacy },
      okDeps(),
    )
    expect(JSON.stringify(legacy)).toBe(snapshot)
  })

  it('emits the split telemetry events (decision.issued + decision.shadow_parity), not decision.parity', async () => {
    const events: { event: string }[] = []
    registerDecisionTelemetrySink((e) => events.push(e as never))
    await runWaiverShadowForEngine(
      { userId: 'u1', leagueId: 'L1', engineInput: fakeEngineInput(), legacyAnalysis: fakeAnalysis() },
      okDeps(),
    )
    expect(events.some((e) => e.event === 'decision.issued')).toBe(true)
    expect(events.some((e) => e.event === 'decision.shadow_parity')).toBe(true)
    expect(events.some((e) => (e.event as string) === 'decision.parity')).toBe(false)
  })
})
