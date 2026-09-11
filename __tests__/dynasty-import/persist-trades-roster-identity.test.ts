import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `persistTradesForSeason` is the SHARED writer: the Sleeper historical backfill reaches it from
 * `backfill-orchestrator`, and every provider's live sync reaches it from `persistLiveTrades`.
 * It is therefore the one place where a roster-identity assumption applies to all six providers at
 * once, and it spent its whole life comparing roster ids with `Number(a) === Number(b)`.
 *
 * 🛑 THAT COMPARISON IS WHY THIS FILE EXISTS, AND WHY IT TESTS THE WRITER RATHER THAN A CONVERTER.
 * `__tests__/fantasy-os/persist-live-trades.test.ts` pins the SHAPE handed to this function; only a
 * test of the function itself can show that a Yahoo or MFL id survives the joins INSIDE it — which
 * side of the trade received which player, and who the partner was.
 *
 * ⚠ Prisma is mocked. This suite is about identity matching, not persistence: what matters is which
 * `leagueTrade.upsert` payloads come out, and a real database would answer a different question
 * more slowly. (It would also answer it against production — see `vitest.setup.db-guard.ts`.)
 */
const upsertTrade = vi.hoisted(() => vi.fn(async (args: unknown) => args))
const upsertHistory = vi.hoisted(() =>
  vi.fn(async (args: { create: { sleeperUsername: string } }) => ({
    id: `hist-${args.create.sleeperUsername}`,
  })),
)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTrade: { upsert: upsertTrade },
    leagueTradeHistory: { upsert: upsertHistory },
    leagueDynastySeason: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/rankings-engine/hall-of-fame', () => ({ upsertSeasonResults: vi.fn() }))

import { persistTradesForSeason } from '@/lib/dynasty-import/normalize-historical'
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'

/** One two-sided trade: `a` sends player 4034 to `b`. */
function trade(a: string, b: string): NormalizedTradeFact {
  return {
    transactionId: 'tx1',
    season: 2026,
    week: 3,
    rosterIds: [a, b],
    adds: { '4034': b },
    drops: { '4034': a },
    draftPicks: [{ season: '2027', round: 1, rosterId: a, previousOwnerId: a, ownerId: b }],
    created: 1757030400000,
    creator: '',
  }
}

/** The `create` payload written for one side of the trade. */
function sideFor(rosterOwner: string) {
  const call = upsertTrade.mock.calls
    .map(([args]) => args as { create: Record<string, unknown> })
    .find((args) => args.create.historyId === `hist-${rosterOwner}`)
  if (!call) throw new Error(`no LeagueTrade row written for ${rosterOwner}`)
  return call.create
}

beforeEach(() => {
  upsertTrade.mockClear()
  upsertHistory.mockClear()
})

describe('persistTradesForSeason — provider-native roster identity', () => {
  it('writes one row per side for integer ids (Sleeper, the case that always worked)', async () => {
    const rows = await persistTradesForSeason(
      'L1',
      2026,
      [trade('1', '2')],
      new Map([
        ['1', 'ownerA'],
        ['2', 'ownerB'],
      ]),
    )

    expect(rows).toBe(2)
    expect(sideFor('ownerA').playersGiven).toEqual(['4034'])
    expect(sideFor('ownerA').playersReceived).toEqual([])
    expect(sideFor('ownerB').playersReceived).toEqual(['4034'])
    expect(sideFor('ownerA').partnerRosterId).toBe(2)
  })

  /*
   * REGRESSION. `Number('461.l.1000.t.1')` is NaN, and `NaN === NaN` is false — so under the old
   * comparison NO side ever matched itself. The rows were still written (the owner lookup used the
   * raw string), but every one of them recorded an empty trade: nobody gave or received anything.
   * That is the worst available failure, because a row exists and looks plausible.
   */
  it('REGRESSION: Yahoo dotted ids match the right side of the trade', async () => {
    const a = '461.l.1000.t.1'
    const b = '461.l.1000.t.2'
    const rows = await persistTradesForSeason(
      'L1',
      2026,
      [trade(a, b)],
      new Map([
        [a, 'ownerA'],
        [b, 'ownerB'],
      ]),
    )

    expect(rows).toBe(2)
    expect(sideFor('ownerA').playersGiven).toEqual(['4034'])
    expect(sideFor('ownerB').playersReceived).toEqual(['4034'])
    expect(sideFor('ownerA').picksGiven).toEqual([{ season: '2027', round: 1 }])
    expect(sideFor('ownerB').picksReceived).toEqual([{ season: '2027', round: 1 }])
  })

  /*
   * REGRESSION. MFL's ids DO coerce to numbers, which makes this the quieter half: '0001' and
   * '0002' became 1 and 2, the sides matched each other, and the row looked entirely correct.
   * It only went wrong at the map lookup. Pinning the writer as well means a future change that
   * reintroduces coercion here fails even if the lookup is left alone.
   */
  it('REGRESSION: MFL zero-padded ids match the right side of the trade', async () => {
    const rows = await persistTradesForSeason(
      'L1',
      2026,
      [trade('0001', '0002')],
      new Map([
        ['0001', 'ownerA'],
        ['0002', 'ownerB'],
      ]),
    )

    expect(rows).toBe(2)
    expect(sideFor('ownerA').playersGiven).toEqual(['4034'])
    expect(sideFor('ownerB').playersReceived).toEqual(['4034'])
  })

  /*
   * `LeagueTrade.partnerRosterId` is `Int?` and consumers join it against `LeagueTeam.externalId`,
   * a String column. Storing `1` for the team whose externalId is '0001' would look populated and
   * never match, so the writer stores null unless the round-trip is lossless.
   */
  it('stores partnerRosterId only when the id round-trips through Int without loss', async () => {
    await persistTradesForSeason('L1', 2026, [trade('0001', '0002')], new Map([['0001', 'ownerA']]))
    expect(sideFor('ownerA').partnerRosterId).toBeNull()

    upsertTrade.mockClear()
    await persistTradesForSeason('L1', 2026, [trade('1', '2')], new Map([['1', 'ownerA']]))
    expect(sideFor('ownerA').partnerRosterId).toBe(2)

    upsertTrade.mockClear()
    await persistTradesForSeason(
      'L1',
      2026,
      [trade('461.l.1000.t.1', '461.l.1000.t.2')],
      new Map([['461.l.1000.t.1', 'ownerA']]),
    )
    expect(sideFor('ownerA').partnerRosterId).toBeNull()
  })

  it('still skips a side whose roster maps to no known owner', async () => {
    const rows = await persistTradesForSeason('L1', 2026, [trade('1', '2')], new Map([['1', 'ownerA']]))
    expect(rows).toBe(1)
    expect(upsertTrade).toHaveBeenCalledTimes(1)
  })
})
