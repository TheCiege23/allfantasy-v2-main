/**
 * @vitest-environment node
 *
 * The trade-context notes must see an engine-UNPRICED player as unpriced, not as a player worth 0.
 *
 * `buildTradeContextNotes` already explains unpriced exposure — it counts `marketValue == null` —
 * and weighs roster concentration from the same values. The analyze route handed it the engine's
 * placeholder 0 for a player the engine could not price, so that note never counted him and the
 * concentration check read him as a worthless asset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const buildTradeContextNotes = vi.fn()
const analysis = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
  logUsageEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
// The route now asks the AI cost gate before the write-up; this suite is about context notes,
// so the gate simply allows the call.
vi.mock('@/lib/ai-protection/costGate', () => ({
  evaluateAiCostGate: vi.fn(async () => ({ ok: true, hasPlan: false, anonymous: false })),
}))
vi.mock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({
  runTradeConsoleAnalysis: vi.fn(async () => analysis.current),
}))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
vi.mock('@/lib/decision-os/trade/canonicalVisibility', () => ({ toTradeCanonicalOpinion: () => null }))
vi.mock('@/lib/decision-os/trade/consoleShadowCompare', () => ({ compareConsoleVerdictWithCanonicalGrade: () => null }))
vi.mock('@/lib/decision-os/trade/enrichmentPort', () => ({ resolveTradeEnrichment: vi.fn(async () => ({ enrichment: {} })) }))
vi.mock('@/lib/trade-intel/tradeContextNotes', () => ({
  buildTradeContextNotes: (...args: unknown[]) => buildTradeContextNotes(...args),
}))

import { POST } from '@/app/api/trade-value/analyze/route'

const line = (name: string, marketValue: number, extra: Record<string, unknown> = {}) => ({
  name, playerId: null, sport: 'NFL', position: 'WR', team: 'SF', headshotUrl: null, logoUrl: null,
  injuryStatus: null, dataSource: 'x', composite: 1, marketValue, pricedSource: 'fantasycalc', ...extra,
})

function request() {
  return new Request('http://localhost/api/trade-value/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sportFilter: 'ALL',
      leagueId: 'l1',
      strategy: 'neutral',
      teamContext: 'my_team',
      sideGive: [{ kind: 'player', name: 'Philadelphia Eagles' }, { kind: 'player', name: 'Brock Purdy' }],
      sideGet: [{ kind: 'player', name: 'DK Metcalf' }],
    }),
  })
}

beforeEach(() => {
  buildTradeContextNotes.mockReset()
  buildTradeContextNotes.mockResolvedValue({
    byeNotes: [], needNotes: [], leverageNotes: [], postureNotes: [], pickNotes: [], scaleNotes: [], formatNotes: [],
  })
  analysis.current = {
    ok: true,
    effectiveSport: 'NFL',
    analysisMode: 'dynasty',
    confidenceScore: 40,
    percentDiff: 10,
    labels: { sideAdvantage: 'even' },
    players: {
      give: [
        line('Philadelphia Eagles', 0, {
          position: 'UNKNOWN',
          pricedSource: 'unknown',
          unpriced: true,
          unpricedReason: { code: 'no_value_on_file', label: 'No feed, historical or draft value on file' },
        }),
        line('Brock Purdy', 5100),
      ],
      get: [line('DK Metcalf', 2004)],
    },
  }
})

describe('the context notes see an unpriced player as unpriced', () => {
  it('🛑 passes null, not the engine\'s placeholder 0', async () => {
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(request())
    expect(res.status).toBe(200)
    expect(buildTradeContextNotes).toHaveBeenCalledTimes(1)
    const args = buildTradeContextNotes.mock.calls[0]![0] as {
      pricedGive: Array<{ name: string; marketValue: number | null }>
      pricedGet: Array<{ name: string; marketValue: number | null }>
    }
    expect(args.pricedGive).toEqual([
      { name: 'Philadelphia Eagles', marketValue: null },
      { name: 'Brock Purdy', marketValue: 5100 },
    ])
    expect(args.pricedGet).toEqual([{ name: 'DK Metcalf', marketValue: 2004 }])
  })

  it('[control] the response itself still carries the engine line, flag and all', async () => {
    const res = await (POST as unknown as (r: Request) => Promise<Response>)(request())
    const body = (await res.json()) as { players: { give: Array<{ unpriced?: boolean; marketValue: number }> } }
    expect(body.players.give[0]!.unpriced).toBe(true)
    expect(body.players.give[0]!.marketValue).toBe(0)
  })
})
