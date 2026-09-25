import { describe, expect, it, vi } from 'vitest'

/**
 * THE PRODUCT CLAIM, AS A TEST.
 *
 * AllFantasy sells a trade value that is specific to YOUR league. Anyone can get a
 * generic number off the internet; the reason to pay for this one is that it moves
 * when your league's rules move, and does NOT move when nothing has changed.
 *
 * That claim is two assertions, and until this file existed neither was guarded:
 *
 *   1. DETERMINISM — the same trade, in the same league, priced twice, is the same
 *      number. A valuation that drifts between refreshes is indistinguishable from
 *      a guess, however good the individual answer looks. This is the assertion
 *      that fails the moment a language model is allowed anywhere near the price.
 *
 *   2. LEAGUE SENSITIVITY — the same trade, in two different leagues, is NOT the
 *      same number. A superflex QB is not a 1QB QB. A 10-team replacement level is
 *      not a 14-team one. If these come out equal, the engine is applying one
 *      global chart to everyone and the league-specific pitch is not true.
 *
 * Both run offline against a synthetic market board, so they test OUR math rather
 * than the vendor's feed, and they cannot go green or red because FantasyCalc had
 * a good or bad day.
 */

vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalytics: vi.fn(async () => null),
}))

vi.mock('@/lib/historical-values', () => ({
  // Real shape, not null: the caller reads `.value` off this unconditionally, and a
  // null mock would fail for a reason that has nothing to do with what is being tested.
  getHistoricalPlayerValue: vi.fn(() => ({ value: null, actualDate: null, source: 'test_stub' })),
  getHistoricalPickValueWeighted: vi.fn(() => ({ value: null, actualDate: null, source: 'test_stub' })),
}))

/** Captures the settings the engine would REQUEST from the market feed. */
const fantasyCalcRequests: Array<Record<string, unknown>> = []
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async (settings: Record<string, unknown>) => {
    fantasyCalcRequests.push(settings)
    return []
  }),
}))

import {
  pricePlayer,
  compositeScore,
  compositeTotal,
  type ValuationContext,
} from '@/lib/hybrid-valuation'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
const DEPTH = 40

/**
 * One synthetic market board, shared by every context in this file.
 *
 * Deliberately IDENTICAL across formats. Real FantasyCalc serves a different board
 * per format, which would make a superflex difference trivially true and prove
 * nothing about our code. Holding the board fixed means any difference the tests
 * below observe was produced by OUR replacement-level math reading OUR league
 * config — which is the part we actually ship.
 */
function marketBoard(): FantasyCalcPlayer[] {
  const rows: FantasyCalcPlayer[] = []
  let id = 1
  for (const position of POSITIONS) {
    for (let rank = 1; rank <= DEPTH; rank += 1) {
      const value = Math.max(80, 9000 - rank * 210)
      rows.push({
        player: {
          id: id,
          name: `${position} Player ${rank}`,
          mflId: String(id),
          sleeperId: String(id),
          position,
          maybeBirthday: null,
          maybeHeight: null,
          maybeWeight: null,
          maybeCollege: null,
          maybeTeam: 'FA',
          maybeAge: 26,
          maybeYoe: 4,
          espnId: null,
          fleaflickerId: null,
        },
        value,
        overallRank: rows.length + 1,
        positionRank: rank,
        trend30Day: 0,
        redraftDynastyValueDifference: 0,
        redraftDynastyValuePercDifference: 0,
        redraftValue: value,
        combinedValue: value,
        maybeMovingStandardDeviation: null,
        maybeMovingStandardDeviationPerc: null,
        maybeMovingStandardDeviationAdjusted: null,
        displayTrend: false,
        maybeOwner: null,
        starter: true,
        maybeTier: null,
        maybeAdp: null,
        maybeTradeFrequency: null,
      })
      id += 1
    }
  }
  return rows
}

const BOARD = marketBoard()

function context(overrides: Partial<ValuationContext> = {}): ValuationContext {
  return {
    // Pinned, not `new Date()`. A date that moves makes a determinism test lie.
    asOfDate: '2026-09-20',
    isSuperFlex: false,
    isDynasty: false,
    ppr: 1,
    numTeams: 12,
    fantasyCalcPlayers: BOARD,
    ...overrides,
  }
}

async function priceOf(name: string, ctx: ValuationContext): Promise<number> {
  const asset = await pricePlayer(name, ctx)
  return compositeScore(asset.assetValue)
}

describe('a value that does not drift', () => {
  it('returns the identical number for the same player in the same league, ten times over', async () => {
    const ctx = context()
    const runs: number[] = []
    for (let i = 0; i < 10; i += 1) {
      runs.push(await priceOf('WR Player 3', ctx))
    }

    expect(new Set(runs).size).toBe(1)
    expect(runs[0]).toBeGreaterThan(0)
  })

  it('returns the identical number across freshly constructed contexts with the same settings', async () => {
    // Guards against state leaking through a module-level cache: two callers with
    // equal settings must not get different answers because of arrival order.
    const first = await priceOf('RB Player 5', context())
    const second = await priceOf('RB Player 5', context())

    expect(first).toBe(second)
  })

  it('prices a whole trade side identically on repeat evaluation', async () => {
    const ctx = context()
    const side = async () =>
      compositeTotal([
        await pricePlayer('WR Player 2', ctx),
        await pricePlayer('RB Player 9', ctx),
      ])

    expect(await side()).toBe(await side())
  })
})

describe('a value that is specific to the league', () => {
  it('prices a quarterback higher in superflex than in a one-quarterback league', async () => {
    const oneQb = await priceOf('QB Player 6', context({ isSuperFlex: false }))
    const superflex = await priceOf('QB Player 6', context({ isSuperFlex: true }))

    expect(superflex).not.toBe(oneQb)
    expect(superflex).toBeGreaterThan(oneQb)
  })

  it('leaves a running back unchanged by the superflex switch', async () => {
    // The superflex lever must move QBs, not everything. A change here would mean
    // the flag is shifting some global constant rather than QB replacement level.
    const oneQb = await priceOf('RB Player 6', context({ isSuperFlex: false }))
    const superflex = await priceOf('RB Player 6', context({ isSuperFlex: true }))

    expect(superflex).toBe(oneQb)
  })

  it('moves replacement level with league size', async () => {
    const shallow = await priceOf('WR Player 20', context({ numTeams: 10 }))
    const deep = await priceOf('WR Player 20', context({ numTeams: 14 }))

    expect(shallow).not.toBe(deep)
  })

  it('flips a quarterback-for-receiver swap between formats', async () => {
    // The verdict itself, not just a component number. This is what a user sees.
    const swap = async (ctx: ValuationContext) =>
      compositeTotal([await pricePlayer('QB Player 4', ctx)]) -
      compositeTotal([await pricePlayer('WR Player 4', ctx)])

    const oneQbDelta = await swap(context({ isSuperFlex: false }))
    const superflexDelta = await swap(context({ isSuperFlex: true }))

    expect(superflexDelta).toBeGreaterThan(oneQbDelta)
  })
})

describe('league settings reach the market feed', () => {
  it('requests a board matched to the league format rather than a default one', async () => {
    fantasyCalcRequests.length = 0

    // No injected board here: this exercises the fetch path, which is where the
    // format is turned into a vendor request.
    await pricePlayer(
      'QB Player 1',
      context({ fantasyCalcPlayers: undefined, isSuperFlex: true, numTeams: 14, ppr: 0.5, isDynasty: true }),
    )

    expect(fantasyCalcRequests.length).toBeGreaterThan(0)
    expect(fantasyCalcRequests[0]).toMatchObject({
      numQbs: 2,
      numTeams: 14,
      ppr: 0.5,
      isDynasty: true,
    })
  })
})
