import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The AI cost gate (lib/ai-protection/costGate.ts): who may spend money on a model call, how
 * often, and — from paywall launch — only with the plan. Every test pins `now` either side of
 * the launch instant, because "the paywall starts Oct 15, not the day a cap shipped" is the
 * rule most likely to be broken by accident.
 */

const { consumeDailyLimitMock, evaluateUserFeatureAccessMock } = vi.hoisted(() => ({
  consumeDailyLimitMock: vi.fn(),
  evaluateUserFeatureAccessMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: consumeDailyLimitMock }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.evaluateUserFeatureAccess = evaluateUserFeatureAccessMock
  }),
}))

import { AI_COST_GATES, evaluateAiCostGate, aiCostGate } from '@/lib/ai-protection/costGate'
import { DEFAULT_PAYWALL_STARTS_AT, getPaywallStartsAt, isPaywallLive } from '@/lib/monetization/paywallLaunch'
import { getAcceptedPlansForFeature } from '@/lib/subscription/feature-access'

const BEFORE = new Date('2026-10-01T12:00:00Z')
const AFTER = new Date('2026-10-20T12:00:00Z')

let seq = 0
/** Each test gets fresh identities: the burst limiter is in-process module state. */
function uid(): string {
  seq += 1
  return `user-${seq}-${Math.random().toString(36).slice(2)}`
}
function req(ip = `10.0.${seq}.${Math.floor(Math.random() * 250)}`): Request {
  return new Request('http://localhost/api/x', { method: 'POST', headers: { 'x-forwarded-for': ip } })
}

function decision(allowed: boolean) {
  return {
    allowed,
    featureId: 'ai_chat',
    entitlement: {},
    requiredPlan: 'AF Pro',
    upgradePath: '/upgrade?plan=pro',
    message: allowed ? 'ok' : 'AF Pro required',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  consumeDailyLimitMock.mockResolvedValue({ success: true, retryAfterSec: 0 })
  evaluateUserFeatureAccessMock.mockResolvedValue(decision(false))
})

describe('paywall launch date', () => {
  it('is midnight US Eastern on Oct 15, 2026', () => {
    expect(DEFAULT_PAYWALL_STARTS_AT.toISOString()).toBe('2026-10-15T04:00:00.000Z')
    expect(isPaywallLive(new Date('2026-10-15T03:59:59Z'), {})).toBe(false)
    expect(isPaywallLive(new Date('2026-10-15T04:00:00Z'), {})).toBe(true)
  })

  it('can be moved by env, and an unparseable value is ignored rather than read as "now"', () => {
    expect(getPaywallStartsAt({ AF_PAYWALL_STARTS_AT: '2026-11-01T04:00:00Z' }).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    )
    expect(getPaywallStartsAt({ AF_PAYWALL_STARTS_AT: 'tomorrow-ish' }).toISOString()).toBe(
      '2026-10-15T04:00:00.000Z',
    )
  })
})

describe('plan-backed gates point at a real plan', () => {
  it.each(
    Object.entries(AI_COST_GATES).filter(([, cfg]) => 'featureId' in cfg && cfg.featureId),
  )('%s', (_key, cfg) => {
    // A feature id with no plan resolves to "locked for everyone" — paying users included.
    expect(getAcceptedPlansForFeature((cfg as { featureId: never }).featureId).length).toBeGreaterThan(0)
  })
})

describe('evaluateAiCostGate', () => {
  it('refuses a signed-out caller when the feature has no anonymous allowance', async () => {
    const out = await evaluateAiCostGate(req(), 'chimmy_voice', null, { now: BEFORE })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('sign_in')
    expect(out.response.status).toBe(401)
  })

  it('lets a signed-out caller use an anonymous allowance before launch, capped per IP', async () => {
    const out = await evaluateAiCostGate(req('203.0.113.9'), 'legacy_chat', null, { now: BEFORE })
    expect(out).toMatchObject({ ok: true, anonymous: true })
    expect(consumeDailyLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ai_cost_gate', callsLimit: AI_COST_GATES.legacy_chat.dailyAnonymous }),
    )
  })

  it('after launch, a signed-out caller must sign in for a paid feature (never more than a free account)', async () => {
    const out = await evaluateAiCostGate(req(), 'legacy_chat', null, { now: AFTER })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('sign_in')
  })

  it('a free feature keeps its anonymous allowance after launch', async () => {
    const out = await evaluateAiCostGate(req(), 'instant_trade', null, { now: AFTER })
    expect(out).toMatchObject({ ok: true, anonymous: true })
  })

  it('BEFORE launch a free account still gets a paid feature, on the free daily cap', async () => {
    const out = await evaluateAiCostGate(req(), 'chimmy_voice', uid(), { now: BEFORE })
    expect(out).toMatchObject({ ok: true, hasPlan: false })
    expect(consumeDailyLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ callsLimit: AI_COST_GATES.chimmy_voice.dailyFree }),
    )
  })

  it('AFTER launch a free account is refused a paid feature with the standard upgrade response', async () => {
    const out = await evaluateAiCostGate(req(), 'chimmy_voice', uid(), { now: AFTER })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('plan')
    expect(out.response.status).toBe(403)
    await expect(out.response.json()).resolves.toMatchObject({
      code: 'feature_not_entitled',
      upgradePath: '/upgrade?plan=pro',
    })
    expect(consumeDailyLimitMock).not.toHaveBeenCalled()
  })

  it('AFTER launch a plan holder gets the feature on the paid daily cap', async () => {
    evaluateUserFeatureAccessMock.mockResolvedValue(decision(true))
    const out = await evaluateAiCostGate(req(), 'chimmy_voice', uid(), { now: AFTER })
    expect(out).toMatchObject({ ok: true, hasPlan: true })
    expect(consumeDailyLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ callsLimit: AI_COST_GATES.chimmy_voice.dailyPaid }),
    )
  })

  it('fails CLOSED on the plan check after launch — no resolved plan is no access', async () => {
    evaluateUserFeatureAccessMock.mockRejectedValue(new Error('db down'))
    const out = await evaluateAiCostGate(req(), 'trade_ai', uid(), { now: AFTER })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(403)
  })

  it('refuses over the daily cap with a 429 that tells the client to fall back', async () => {
    consumeDailyLimitMock.mockResolvedValue({ success: false, retryAfterSec: 3600 })
    const out = await evaluateAiCostGate(req(), 'trade_ai', uid(), { now: BEFORE })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reason).toBe('daily')
    expect(out.response.status).toBe(429)
    await expect(out.response.json()).resolves.toMatchObject({
      code: 'daily_limit_reached',
      useDeterministicFallback: true,
    })
  })

  it('fails OPEN on the daily counter — a counter outage must not take AI down', async () => {
    consumeDailyLimitMock.mockRejectedValue(new Error('db down'))
    const out = await evaluateAiCostGate(req(), 'trade_ai', uid(), { now: BEFORE })
    expect(out.ok).toBe(true)
  })

  it('enforces the per-minute burst limit per caller', async () => {
    const user = uid()
    const r = req()
    const limit = AI_COST_GATES.share_copy.perMinute
    for (let i = 0; i < limit; i += 1) {
      expect((await evaluateAiCostGate(r, 'share_copy', user, { now: BEFORE })).ok).toBe(true)
    }
    const over = await evaluateAiCostGate(r, 'share_copy', user, { now: BEFORE })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toBe('rate')
    // A different caller is unaffected.
    expect((await evaluateAiCostGate(r, 'share_copy', uid(), { now: BEFORE })).ok).toBe(true)
  })

  it('a gate with no daily cap never touches the counter (mock-draft picks: a 180-pick draft must finish)', async () => {
    const out = await evaluateAiCostGate(req(), 'mock_ai_pick', uid(), { now: AFTER })
    expect(out.ok).toBe(true)
    expect(consumeDailyLimitMock).not.toHaveBeenCalled()
    expect(evaluateUserFeatureAccessMock).not.toHaveBeenCalled()
  })

  it('aiCostGate returns null to proceed and the response to refuse', async () => {
    await expect(aiCostGate(req(), 'trade_ai', uid(), { now: BEFORE })).resolves.toBeNull()
    const refused = await aiCostGate(req(), 'trade_ai', null, { now: BEFORE })
    expect(refused?.status).toBe(401)
  })
})
