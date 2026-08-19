/**
 * Decision OS — Trade Learning Phase 9 (Staging Migration & End-to-End
 * Validation). Regression test for a real bug found during real staging
 * validation: computeInputHash() (lib/trade-engine/trade-event-logger.ts)
 * did not account for afLeagueTradeId, so two DISTINCT real trades with
 * identical give/receive assets collided on the pre-existing `inputHash`
 * unique constraint — every real trade after the first with the same test
 * assets silently failed to log at all. Fixed by folding afLeagueTradeId
 * into the hash payload (only when present, so hypothetical-evaluation
 * callers — which never pass it — are completely unaffected).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockTradeOfferEventCreate } = vi.hoisted(() => ({
  mockTradeOfferEventCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeOfferEvent: { create: mockTradeOfferEventCreate },
  },
}))

import { logTradeOfferEvent, type TradeOfferEventInput } from '@/lib/trade-engine/trade-event-logger'

function baseInput(overrides: Partial<TradeOfferEventInput> = {}): TradeOfferEventInput {
  return {
    leagueId: 'league-1',
    assetsGiven: [{ name: 'Player A', value: 3000, type: 'player' }],
    assetsReceived: [{ name: 'Player B', value: 3200, type: 'player' }],
    acceptProb: 0.5,
    verdict: 'FAIR',
    mode: 'LIVE_PROPOSAL',
    ...overrides,
  }
}

describe('computeInputHash — afLeagueTradeId collision fix (Phase 9 regression)', () => {
  afterEach(() => vi.clearAllMocks())

  it('two distinct real trades with IDENTICAL assets produce DIFFERENT inputHash values and both succeed', async () => {
    mockTradeOfferEventCreate.mockImplementation(async ({ data }: any) => ({ id: `event-for-${data.afLeagueTradeId}`, __hash: data.inputHash }))

    await logTradeOfferEvent(baseInput({ afLeagueTradeId: 'trade-A' }))
    await logTradeOfferEvent(baseInput({ afLeagueTradeId: 'trade-B' }))

    expect(mockTradeOfferEventCreate).toHaveBeenCalledTimes(2)
    const hashA = mockTradeOfferEventCreate.mock.calls[0][0].data.inputHash
    const hashB = mockTradeOfferEventCreate.mock.calls[1][0].data.inputHash
    expect(hashA).not.toBe(hashB) // the bug: these used to be identical and collide
  })

  it('preserves existing behavior for hypothetical-evaluation callers (no afLeagueTradeId): identical input still produces the identical hash', async () => {
    mockTradeOfferEventCreate.mockImplementation(async ({ data }: any) => ({ id: 'event-1', __hash: data.inputHash }))

    await logTradeOfferEvent(baseInput({ mode: 'INSTANT' })) // no afLeagueTradeId, matches a real evaluator-tool call
    const hash1 = mockTradeOfferEventCreate.mock.calls[0][0].data.inputHash

    mockTradeOfferEventCreate.mockClear()
    await logTradeOfferEvent(baseInput({ mode: 'INSTANT' }))
    const hash2 = mockTradeOfferEventCreate.mock.calls[0][0].data.inputHash

    expect(hash1).toBe(hash2) // unchanged dedup-caching behavior for these callers
  })

  it('a real trade\'s hash also differs from what an evaluator-tool call with the same assets would produce', async () => {
    mockTradeOfferEventCreate.mockImplementation(async ({ data }: any) => ({ id: 'x', __hash: data.inputHash }))

    await logTradeOfferEvent(baseInput({ mode: 'LIVE_PROPOSAL', afLeagueTradeId: 'trade-C' }))
    const liveHash = mockTradeOfferEventCreate.mock.calls[0][0].data.inputHash

    mockTradeOfferEventCreate.mockClear()
    await logTradeOfferEvent(baseInput({ mode: 'INSTANT' }))
    const evalHash = mockTradeOfferEventCreate.mock.calls[0][0].data.inputHash

    expect(liveHash).not.toBe(evalHash) // different mode already differentiates these too, confirmed still true
  })
})
