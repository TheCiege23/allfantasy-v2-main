/**
 * Decision OS Replay Framework Phase 9 — regression test for two real bugs
 * found and fixed during corpus expansion:
 *
 * 1. `toAssets()`/`toRosterAssets()` previously assigned disjoint synthetic
 *    ID namespaces (`replay-N` vs. `roster-N`) to the same real player
 *    depending on which array they appeared in. Since `computeLineupDelta()`
 *    matches give/receive against the roster by `Asset.id` to compute the
 *    "after" lineup, the traded player was never actually recognized as
 *    present in the roster — so it was never removed, and the received
 *    player was only ever appended, never substituted in place. Fixed by
 *    threading the real, stable Sleeper player ID (`providerAssetId`)
 *    through consistently.
 * 2. `assetsGiven`/`assetsReceived` never carried `pos` at all, and
 *    `computeBestLineupPPG()` only counts a player with a real `pos` —
 *    so even with (1) fixed, an incoming player was silently invisible to
 *    the lineup calculation, meaning `deltaThem`/`deltaYou` could only ever
 *    decrease or stay flat, never increase. Fixed by threading `pos`
 *    through the payload the same way `providerAssetId` was.
 *
 * This test calls the REAL, unmocked computeTradeDrivers() (only the
 * Prisma-backed calibration reads are mocked) to prove both fixes
 * end-to-end, not just that a mock received the right argument.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockGetCalibratedWeights, mockCalibrateAcceptProbability } = vi.hoisted(() => ({
  mockGetCalibratedWeights: vi.fn(),
  mockCalibrateAcceptProbability: vi.fn(),
}))

vi.mock('@/lib/trade-engine/accept-calibration', () => ({
  getCalibratedWeights: mockGetCalibratedWeights,
  calibrateAcceptProbability: mockCalibrateAcceptProbability,
}))

import { runTradeBacktest } from '@/lib/replay-framework/backtest/tradeBacktestExecutor'

const CALIBRATED_WEIGHTS = { b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 }
const ROSTER_POSITIONS = ['RB', 'RB', 'BN', 'BN']

describe('runTradeBacktest — real ID consistency between traded assets and roster context', () => {
  afterEach(() => vi.clearAllMocks())

  it('a real substitution (bench player -> elite player, same provider ID as the roster entry it replaces) produces a non-zero, real deltaThem', async () => {
    mockGetCalibratedWeights.mockResolvedValue(CALIBRATED_WEIGHTS)
    mockCalibrateAcceptProbability.mockImplementation(async (raw: number) => ({ calibrated: raw, raw, isotonicApplied: false }))

    // The counterparty's real roster has a specific, identifiable bench RB
    // (provider ID "bench-rb-1") they are about to trade away.
    const counterpartyRoster = [
      { name: 'Weak RB', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-1' },
      { name: 'Other Weak RB', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-2' },
    ]

    // The trade: the counterparty RECEIVES an elite RB and GIVES AWAY
    // "bench-rb-1" — the same providerAssetId as the roster entry above, so
    // the fix should let computeLineupDelta() correctly remove it and add
    // the elite RB in its place.
    const result = await runTradeBacktest({
      replayId: 'replay-1',
      season: 2025,
      payload: {
        assetsGiven: [{ name: 'Elite RB', value: 9000, type: 'player', pos: 'RB', providerAssetId: 'elite-rb' }],
        assetsReceived: [{ name: 'Weak RB', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-1' }],
        proposerRoster: [{ name: 'Elite RB', value: 9000, type: 'player', pos: 'RB', providerAssetId: 'elite-rb' }],
        counterpartyRoster,
      },
      isSuperFlex: false,
      providerStatus: 'complete',
      resolvedAt: new Date(),
      rosterPositions: ROSTER_POSITIONS,
    })

    const output = result.backtestedOutput as { deltaThem?: number | null; hasLineupData?: boolean }
    expect(output.hasLineupData).toBe(true)
    // The elite RB genuinely displaces one of the weak RBs in the
    // counterparty's best-possible lineup -- a real, non-zero PPG gain.
    expect(output.deltaThem).not.toBe(0)
    expect(output.deltaThem!).toBeGreaterThan(0)
  })

  it('a like-for-like swap (identical value/position, correctly ID-matched) produces exactly zero deltaThem -- confirming the fix reflects reality, not a residual artifact', async () => {
    mockGetCalibratedWeights.mockResolvedValue(CALIBRATED_WEIGHTS)
    mockCalibrateAcceptProbability.mockImplementation(async (raw: number) => ({ calibrated: raw, raw, isotonicApplied: false }))

    const counterpartyRoster = [
      { name: 'Weak RB A', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-a' },
      { name: 'Weak RB B', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-b' },
    ]

    const result = await runTradeBacktest({
      replayId: 'replay-2',
      season: 2025,
      payload: {
        assetsGiven: [{ name: 'Bench Swap Player', value: 300, type: 'player', pos: 'RB', providerAssetId: 'incoming-equivalent' }],
        assetsReceived: [{ name: 'Weak RB A', value: 300, type: 'player', pos: 'RB', providerAssetId: 'bench-rb-a' }],
        proposerRoster: [{ name: 'Bench Swap Player', value: 300, type: 'player', pos: 'RB', providerAssetId: 'incoming-equivalent' }],
        counterpartyRoster,
      },
      isSuperFlex: false,
      providerStatus: 'complete',
      resolvedAt: new Date(),
      rosterPositions: ROSTER_POSITIONS,
    })

    const output = result.backtestedOutput as { deltaThem?: number | null }
    expect(output.deltaThem).toBe(0)
  })
})
