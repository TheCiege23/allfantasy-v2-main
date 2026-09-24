import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The cost gate's EFFECT on the routes, not its presence: a refused gate must stop the paid
 * call (voice), fall back instead of failing where a free answer exists (Trade Center, share
 * captions), and the mock draft must stop asking Grok about players it already asked about.
 */

const { evaluateAiCostGateMock, consumeDailyLimitMock } = vi.hoisted(() => ({
  evaluateAiCostGateMock: vi.fn(),
  consumeDailyLimitMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection/costGate', async () => {
  const { NextResponse } = await import('next/server')
  return {
    evaluateAiCostGate: evaluateAiCostGateMock,
    aiCostGate: vi.fn(async (...args: unknown[]) => {
      const out = await evaluateAiCostGateMock(...args)
      return out.ok ? null : out.response
    }),
    __NextResponse: NextResponse,
  }
})
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: consumeDailyLimitMock }))

import { NextResponse } from 'next/server'

// A valid console request (shape from __tests__/trades/analyze-route-unpriced-context.test.ts).
const TRADE_BODY = {
  sportFilter: 'ALL',
  strategy: 'neutral',
  teamContext: 'my_team',
  sideGive: [{ kind: 'player', name: 'Brock Purdy' }],
  sideGet: [{ kind: 'player', name: 'DK Metcalf' }],
}
const ANALYSIS = {
  ok: true,
  effectiveSport: 'NFL',
  analysisMode: 'dynasty',
  confidenceScore: 40,
  percentDiff: 0,
  labels: { sideAdvantage: 'even' },
  players: { give: [], get: [] },
}

function refused(reason: 'plan' | 'daily' | 'rate' | 'sign_in', status = 403) {
  return { ok: false, reason, response: NextResponse.json({ error: 'refused', reason }, { status }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  evaluateAiCostGateMock.mockResolvedValue({ ok: true, hasPlan: false, anonymous: false })
})

describe('Chimmy voice', () => {
  it('a refused gate is returned as-is and the paid text-to-speech API is never called', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    evaluateAiCostGateMock.mockResolvedValue(refused('plan', 403))
    const { POST } = await import('@/app/api/chimmy/voice/route')
    const res = await POST(
      new Request('http://localhost/api/chimmy/voice', {
        method: 'POST',
        body: JSON.stringify({ text: 'hello' }),
      }) as never,
    )
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('Trade Center (/api/trade-value/analyze)', () => {
  it.each(['plan', 'daily'] as const)(
    'a %s refusal turns the write-up OFF (skipAi) and still returns the verdict',
    async (reason) => {
      vi.resetModules()
      const runMock = vi.fn(async () => ANALYSIS)
      vi.doMock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({ runTradeConsoleAnalysis: runMock }))
      vi.doMock('@/lib/telemetry/usage', () => ({
        withApiUsage: () => (handler: unknown) => handler,
        logUsageEvent: vi.fn(async () => undefined),
      }))
      vi.doMock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
      vi.doMock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
      vi.doMock('@/lib/decision-os/trade/canonicalVisibility', () => ({ toTradeCanonicalOpinion: () => null }))
      vi.doMock('@/lib/decision-os/trade/consoleShadowCompare', () => ({ compareConsoleVerdictWithCanonicalGrade: () => null }))
      vi.doMock('@/lib/decision-os/trade/enrichmentPort', () => ({ resolveTradeEnrichment: vi.fn(async () => ({ enrichment: {} })) }))
      vi.doMock('@/lib/trade-intel/tradeContextNotes', () => ({ buildTradeContextNotes: vi.fn(async () => null) }))
      evaluateAiCostGateMock.mockResolvedValue(refused(reason, reason === 'daily' ? 429 : 403))

      const { POST } = await import('@/app/api/trade-value/analyze/route')
      const res = await POST(
        new Request('http://localhost/api/trade-value/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(TRADE_BODY),
        }),
      )
      const body = await res.json()
      if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
      expect(runMock).toHaveBeenCalledTimes(1)
      expect(runMock.mock.calls[0][0]).toMatchObject({ skipAi: true })
      expect(body.aiLimit).toMatchObject({ reason, upgradePath: '/pricing' })
    },
  )

  it('an allowed gate leaves the write-up on and adds no aiLimit', async () => {
    vi.resetModules()
    const runMock = vi.fn(async () => ANALYSIS)
    vi.doMock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({ runTradeConsoleAnalysis: runMock }))
    vi.doMock('@/lib/telemetry/usage', () => ({
      withApiUsage: () => (handler: unknown) => handler,
      logUsageEvent: vi.fn(async () => undefined),
    }))
    vi.doMock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
    vi.doMock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
    vi.doMock('@/lib/decision-os/trade/canonicalVisibility', () => ({ toTradeCanonicalOpinion: () => null }))
    vi.doMock('@/lib/decision-os/trade/consoleShadowCompare', () => ({ compareConsoleVerdictWithCanonicalGrade: () => null }))
    vi.doMock('@/lib/decision-os/trade/enrichmentPort', () => ({ resolveTradeEnrichment: vi.fn(async () => ({ enrichment: {} })) }))
    vi.doMock('@/lib/trade-intel/tradeContextNotes', () => ({ buildTradeContextNotes: vi.fn(async () => null) }))

    const { POST } = await import('@/app/api/trade-value/analyze/route')
    const res = await POST(
      new Request('http://localhost/api/trade-value/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(TRADE_BODY),
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(runMock.mock.calls[0][0]).toMatchObject({ skipAi: false })
    expect(body).not.toHaveProperty('aiLimit')
  })
})

describe('share captions (/api/share/generate-copy)', () => {
  function shareMocks(generateShareCopy: ReturnType<typeof vi.fn>) {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({ prisma: { shareableMoment: { findFirst: vi.fn(), update: vi.fn() } } }))
    vi.doMock('@/lib/social-sharing/GrokShareCopyService', () => ({
      isGrokShareConfigured: () => true,
      generateShareCopy,
      getTemplateShareCopy: () => ({ caption: 'template caption', headline: 'h', cta: 'c', hashtags: [], platformVariants: {} }),
    }))
  }
  const shareReq = () =>
    new Request('http://localhost/api/share/generate-copy', {
      method: 'POST',
      body: JSON.stringify({ shareType: 'winning_matchup', sport: 'NFL' }),
    })

  it('over the cap, the caption still comes back — from the template, with no Grok call', async () => {
    const generateShareCopy = vi.fn(async () => ({ caption: 'grok caption', headline: 'h', cta: 'c', hashtags: [], platformVariants: {} }))
    shareMocks(generateShareCopy)
    evaluateAiCostGateMock.mockResolvedValue(refused('daily', 429))
    const { POST } = await import('@/app/api/share/generate-copy/route')
    const res = await POST(shareReq())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ caption: 'template caption', fromGrok: false })
    expect(generateShareCopy).not.toHaveBeenCalled()
  })

  it('under the cap, Grok writes it', async () => {
    const generateShareCopy = vi.fn(async () => ({ caption: 'grok caption', headline: 'h', cta: 'c', hashtags: [], platformVariants: {} }))
    shareMocks(generateShareCopy)
    const { POST } = await import('@/app/api/share/generate-copy/route')
    const res = await POST(shareReq())
    await expect(res.json()).resolves.toMatchObject({ caption: 'grok caption', fromGrok: true })
  })
})

describe('mock draft Grok news cache', () => {
  it('asks Grok once per player, not once per pick', async () => {
    const { fetchPlayerNewsCached, __resetGrokNewsCacheForTests } = await import('@/lib/mock-draft/grokNewsCache')
    __resetGrokNewsCacheForTests()
    const grok = vi.fn(async (names: string[]) =>
      names.map((n) => ({ playerName: n, sentiment: 'neutral', news: [], buzz: '' })),
    )
    const t0 = 1_000_000
    await fetchPlayerNewsCached(['A', 'B', 'C'], grok as never, t0)
    // Next pick: A was drafted, D appears. Only D is new.
    const second = await fetchPlayerNewsCached(['B', 'C', 'D'], grok as never, t0 + 60_000)
    expect(grok).toHaveBeenCalledTimes(2)
    expect(grok.mock.calls[1][0]).toEqual(['D'])
    expect(second.map((i) => i.playerName)).toEqual(['B', 'C', 'D'])
    // Same board again: nothing new, no call at all.
    await fetchPlayerNewsCached(['B', 'C', 'D'], grok as never, t0 + 120_000)
    expect(grok).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed fetch, caches "no news", and refetches after two hours', async () => {
    const { fetchPlayerNewsCached, __resetGrokNewsCacheForTests } = await import('@/lib/mock-draft/grokNewsCache')
    __resetGrokNewsCacheForTests()
    const failing = vi.fn(async () => {
      throw new Error('grok down')
    })
    expect(await fetchPlayerNewsCached(['X'], failing as never, 0)).toEqual([])
    const quiet = vi.fn(async () => []) // Grok answered: no news for X
    await fetchPlayerNewsCached(['X'], quiet as never, 1)
    expect(quiet).toHaveBeenCalledTimes(1) // the failure was not cached
    await fetchPlayerNewsCached(['X'], quiet as never, 2)
    expect(quiet).toHaveBeenCalledTimes(1) // "no news" was cached
    await fetchPlayerNewsCached(['X'], quiet as never, 2 * 60 * 60 * 1000 + 10)
    expect(quiet).toHaveBeenCalledTimes(2) // expired
  })
})

describe('SMS daily cap', () => {
  it('defaults to 15 a day, honours SMS_DAILY_CAP_PER_USER, ignores nonsense', async () => {
    const { getSmsDailyCap } = await import('@/lib/notifications/smsDailyCap')
    expect(getSmsDailyCap({})).toBe(15)
    expect(getSmsDailyCap({ SMS_DAILY_CAP_PER_USER: '5' })).toBe(5)
    expect(getSmsDailyCap({ SMS_DAILY_CAP_PER_USER: 'lots' })).toBe(15)
  })

  it('reserves against the durable counter and fails open if it is down', async () => {
    const { reserveSmsToday } = await import('@/lib/notifications/smsDailyCap')
    consumeDailyLimitMock.mockResolvedValueOnce({ success: false, retryAfterSec: 60 })
    expect(await reserveSmsToday('u1')).toBe(false)
    consumeDailyLimitMock.mockRejectedValueOnce(new Error('db down'))
    expect(await reserveSmsToday('u1')).toBe(true)
  })
})

describe('every audited paid-model route asks the gate', () => {
  // The routes the 2026-09-24 audit found spending money with no gate. A route is only listed
  // here after its gate call was placed ahead of the paid call; this keeps a refactor from
  // silently dropping one.
  const ROUTES = [
    'app/api/chimmy/voice/route.ts',
    'app/api/start-sit/chimmy/route.ts',
    'app/api/share/generate-copy/route.ts',
    'app/api/ai/trade-analysis/route.ts',
    'app/api/dynasty-trade-analyzer/route.ts',
    'app/api/trades/analyze/route.ts',
    'app/api/trade-finder/route.ts',
    'app/api/ai/draft-help/route.ts',
    'app/api/draft-ai/route.ts',
    'app/api/ai/weekly-recap/route.ts',
    'app/api/ai-tools/start-sit/analyze/route.ts',
    'app/api/leagues/[leagueId]/ai/start-sit/route.ts',
    'app/api/leagues/[leagueId]/idp/ai/route.ts',
    'app/api/leagues/[leagueId]/devy/ai/route.ts',
    'server/api-route-modules/legacy/chat/route.ts',
    'app/api/trade-value/chimmy/route.ts',
    'app/api/instant/trade/route.ts',
    'app/api/trade-value/analyze/route.ts',
    'app/api/mock-draft/ai-pick/route.ts',
    'app/api/mock-draft/simulate/route.ts',
    'app/api/mock-draft/needs/route.ts',
    'app/api/mock-draft/trade-action/route.ts',
    'app/api/mock-draft/trade-propose/route.ts',
    'app/api/mock-draft/trade-sim/route.ts',
    'app/api/mock-draft/trade-simulate/route.ts',
    'app/api/mock-draft/update-weekly/route.ts',
  ]
  it.each(ROUTES)('%s', (rel) => {
    const src = readFileSync(path.join(process.cwd(), rel), 'utf8')
    expect(src).toMatch(/\b(aiCostGate|evaluateAiCostGate)\(/)
  })
})
