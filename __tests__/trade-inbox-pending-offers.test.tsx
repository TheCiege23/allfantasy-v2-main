/**
 * Phase 3 — Inbox & Sent stop refusing, without starting to lie.
 *
 * Both panels used to be a flat "pending offers are not ingested". That was
 * true of the database and false of the platform: Sleeper exposes open offers,
 * and `scanPendingSleeperTrades` has read them for the league Trades tab for a
 * while. Wiring them onto the Trade Center is the easy half.
 *
 * The hard half is that an empty inbox is TWO facts — "we looked and nothing is
 * waiting" and "we never looked" — and they are both zero rows. Every test in
 * the second block exists to keep them apart.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildTradeAssetsForRoster,
  scanPendingSleeperTrades,
} from '@/lib/provider-trades/scanPendingSleeperTrades'
import { toPickedAssets, nativeItemsToAssets } from '@/components/core-app/screens/TradeInbox'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const INBOX = read('components/core-app/screens/TradeInbox.tsx')
const CENTER = read('components/core-app/screens/TradeCenter.tsx')
const PROPOSE = read('components/core-app/screens/TradeProposePanel.tsx')
const ROUTE = read('app/api/league/trades-panel/route.ts')
const SCANNER = read('lib/provider-trades/scanPendingSleeperTrades.ts')

const players = {
  p1: { full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
  p2: { full_name: 'Puka Nacua', position: 'WR', team: 'LAR' },
}

describe('⚠ FAAB was being dropped on the floor', () => {
  it('credits a budget transfer to the receiving roster and debits the sender', () => {
    /*
     * "My WR2 for your WR3 plus $40" used to render as a straight player swap.
     * In a guillotine or survivor league the $40 IS the trade.
     */
    const tx = {
      adds: {},
      drops: {},
      draft_picks: [],
      waiver_budget: [{ sender: 1, receiver: 2, amount: 40 }],
    }

    const sender = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 1, players })
    expect(sender.assetsGiven.map((a) => a.faabAmount)).toEqual([40])
    expect(sender.assetsReceived).toEqual([])

    const receiver = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 2, players })
    expect(receiver.assetsReceived.map((a) => a.faabAmount)).toEqual([40])
    expect(receiver.assetsGiven).toEqual([])
  })

  it('ignores a zero or malformed budget line rather than rendering $0', () => {
    const tx = {
      adds: {},
      drops: {},
      draft_picks: [],
      waiver_budget: [
        { sender: 1, receiver: 2, amount: 0 },
        { sender: 1, receiver: 2, amount: Number.NaN },
      ],
    }
    const out = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 1, players })
    expect(out.assetsGiven).toEqual([])
  })

  it('still works on a transaction with no waiver_budget key at all', () => {
    const out = buildTradeAssetsForRoster({
      tx: { adds: { p2: 1 }, drops: { p1: 1 }, draft_picks: [] },
      userRosterId: 1,
      players,
    })
    expect(out.assetsGiven.map((a) => a.playerName)).toEqual(['Josh Allen'])
    expect(out.assetsReceived.map((a) => a.playerName)).toEqual(['Puka Nacua'])
  })

  it('carries pick coordinates as numbers alongside the human label', () => {
    // A consumer that rebuilds the pick as an asset must not have to parse
    // "2027 1st" back out of prose.
    const out = buildTradeAssetsForRoster({
      tx: { adds: {}, drops: {}, draft_picks: [{ season: '2027', round: 2, roster_id: 1 }] } as never,
      userRosterId: 1,
      players,
    })
    expect(out.assetsReceived[0]!.pickRound).toBe('2027 2nd')
    expect(out.assetsReceived[0]!.pickYear).toBe(2027)
    expect(out.assetsReceived[0]!.pickRoundNumber).toBe(2)
  })
})

describe('⚠ an empty list is not an answer on its own', () => {
  it('reports scanned:false with a reason when no Sleeper account is known', async () => {
    const out = await scanPendingSleeperTrades({ platformLeagueId: 'abc', ownerSleeperId: '' })
    expect(out.scanned).toBe(false)
    expect(out.trades).toEqual([])
    expect(out.reason).toBeTruthy()
  })

  it('reports scanned:false when there is no league to scan', async () => {
    const out = await scanPendingSleeperTrades({ platformLeagueId: '  ', ownerSleeperId: 'u1' })
    expect(out.scanned).toBe(false)
    expect(out.reason).toBeTruthy()
  })

  it('keeps the four refusals distinct rather than collapsing them', () => {
    // Each of these is a different thing to tell the manager, and only one of
    // them is something they can fix.
    expect(SCANNER).toContain('we do not know which Sleeper account is yours in this league')
    expect(SCANNER).toContain('no roster in this Sleeper league is owned by your linked account')
    expect(SCANNER).toContain('Sleeper did not answer for this league')
    expect(SCANNER).toContain('Sleeper could not be reached')
  })

  it('⚠ no longer turns a refused week into an empty week', () => {
    /*
     * The old `.catch(() => [])` per week is how an outage became an empty
     * inbox. A throw now counts a week as unanswered; a null body is still
     * empty, because that is Sleeper's own spelling for a quiet week.
     */
    expect(SCANNER).toContain('weeksUnanswered += 1')
    expect(SCANNER).not.toContain('getLeagueTransactions(platformLeagueId, week).catch(')
  })

  it('keeps the list-only wrapper so existing callers do not change', () => {
    expect(SCANNER).toContain('export async function scanPendingSleeperTradesForLeague')
    expect(SCANNER).toContain('return (await scanPendingSleeperTrades(args)).trades')
  })
})

describe('⚠ the route reports the scan, not just its result', () => {
  it('returns a pending envelope on EVERY branch', () => {
    /*
     * Three now: Sleeper, Yahoo, and everything else. Every one of them needs
     * an envelope — a branch without one has no way to say "we never looked"
     * and renders as an empty inbox instead.
     */
    expect(ROUTE.split('pending: {').length - 1).toBe(3)
    expect(ROUTE).toContain('scanned: pendingScan.scanned')
    expect(ROUTE).toContain('pendingOffers: builderOffers(providerPending)')
  })

  it('says which platform it could not read, and which two it can', () => {
    expect(ROUTE).toContain('we do not read pending offers on ${platform} yet')
    expect(ROUTE).toContain('Sleeper and Yahoo are the two we can')
  })

  it('distinguishes an unlinked account from a provider outage', () => {
    expect(ROUTE).toContain('link your Sleeper account, or claim your team')
  })

  it('⚠ builds the offer projection from typed fields, not display strings', () => {
    /*
     * `activeTrades` assets are `{ label, sublabel }`. Rebuilding a pick from
     * "2027 1st round pick" means parsing prose, and the first reword breaks
     * the reload silently.
     */
    expect(ROUTE).toContain('pickYear: a.pickYear ?? null')
    expect(ROUTE).toContain('faabAmount: a.faabAmount ?? null')
  })
})

describe('⚠ the inbox never claims an empty league it did not read', () => {
  it('checks scanned BEFORE it checks for zero rows', () => {
    const scannedBranch = INBOX.indexOf('pending && !pending.scanned ?')
    const emptyBranch = INBOX.indexOf('rows.length === 0 ?')
    expect(scannedBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(-1)
    expect(scannedBranch).toBeLessThan(emptyBranch)
  })

  it('qualifies "nothing waiting" when some weeks went unanswered', () => {
    expect(INBOX).toContain('pending.weeksUnanswered > 0')
  })

  it('⚠ offers no accept, reject or counter — the provider has no write endpoint', () => {
    // A control AllFantasy cannot honour is a lie with a button on it.
    expect(INBOX).not.toContain("method: 'POST'")
    expect(INBOX).toContain('Act on it in Sleeper')
  })

  it('names the AF-native proposals separately instead of mixing the streams', () => {
    expect(INBOX).toContain("t.status !== 'pending_on_sleeper'")
  })
})

describe('⚠ loading an offer into the builder analyses THAT offer', () => {
  it('rebuilds players, picks and FAAB', () => {
    const { picked, dropped } = toPickedAssets([
      {
        playerId: 'sleeper-123',
        name: 'Josh Allen',
        position: 'QB',
        team: 'BUF',
        isPick: false,
        pickYear: null,
        pickRound: null,
        faabAmount: null,
      },
      {
        playerId: null,
        name: '2027 1st round pick',
        position: 'PICK',
        team: null,
        isPick: true,
        pickYear: 2027,
        pickRound: 1,
        faabAmount: null,
      },
      {
        playerId: null,
        name: '$40 FAAB',
        position: 'FAAB',
        team: null,
        isPick: false,
        pickYear: null,
        pickRound: null,
        faabAmount: 40,
      },
    ])

    expect(dropped).toEqual([])
    expect(picked.map((p) => p.kind)).toEqual(['player', 'pick', 'faab'])
    expect(picked[1]).toMatchObject({ year: 2027, round: 1 })
    expect(picked[2]).toMatchObject({ amount: 40 })
  })

  it("⚠ does not pass Sleeper's player id off as one of ours", () => {
    /*
     * `playerId` on the analyzer means an id in OUR space. Handing it a Sleeper
     * id would either miss or resolve to a different player — the second is
     * worse, and silent.
     */
    const { picked } = toPickedAssets([
      {
        playerId: 'sleeper-123',
        name: 'Josh Allen',
        position: 'QB',
        team: 'BUF',
        isPick: false,
        pickYear: null,
        pickRound: null,
        faabAmount: null,
      },
    ])
    expect(picked[0]).toMatchObject({ kind: 'player', playerId: null, name: 'Josh Allen' })
  })

  it('⚠ reports an asset it could not rebuild instead of quietly shortening the deal', () => {
    // A silently shortened offer analyses as a different deal — one side
    // lighter than what the manager was actually sent.
    const { picked, dropped } = toPickedAssets([
      {
        playerId: null,
        name: 'a pick with no year',
        position: 'PICK',
        team: null,
        isPick: true,
        pickYear: null,
        pickRound: null,
        faabAmount: null,
      },
    ])
    expect(picked).toEqual([])
    expect(dropped).toEqual(['a pick with no year'])
  })

  it('replaces the board and clears the verdict rather than merging', () => {
    expect(CENTER).toContain('REPLACES, NEVER APPENDS')
    /*
     * ⚠ ASSERTS THE WIRING, NOT THE WHOLE TAG. This pinned the complete JSX element
     * as one literal, so adding ANY prop to <TradeInbox> failed it — which is what
     * happened when the counter control was added. The claim worth keeping is that
     * the inbox hands offers to `loadOffer` (the handler that replaces rather than
     * appends); how many other props the element carries is not part of it.
     */
    expect(CENTER).toMatch(/<TradeInbox[\s\S]{0,240}?onLoad=\{loadOffer\}/)
  })

  it('🛑 the counter control is wired to a handler, not left as a dead button', () => {
    /*
     * `/trades/<id>/counter` shipped with ZERO UI callers — the route worked and no
     * screen could reach it, so the inbox told people counters "live on the league
     * page" where nothing existed. These pin both ends of the connection: the inbox
     * receives a handler, and the propose panel knows how to send to the counter
     * route. Either one alone can go green while the feature is unreachable.
     */
    expect(CENTER).toMatch(/<TradeInbox[\s\S]{0,240}?onCounter=\{startCounter\}/)
    expect(CENTER).toContain('counteringTradeId={countering?.tradeId ?? null}')
    expect(PROPOSE).toContain('/counter')
  })

  it('🛑 a sent counter disarms counter mode and refetches the offer it closed', () => {
    /*
     * Two failures this prevents, both silent:
     *
     * Leaving counter mode armed points the NEXT send at a trade the engine has
     * already flipped to 'countered', so the second attempt fails with a message
     * about a trade the manager considers finished.
     *
     * Not refetching leaves the answered offer in the list with its Counter button
     * still on it — the panel says "their offer is now closed" while the list beside
     * it says otherwise.
     */
    expect(CENTER).toContain('setCountering(null)')
    expect(CENTER).toContain('setInboxReloadToken((n) => n + 1)')
    expect(CENTER).toContain('reloadToken={inboxReloadToken}')
    /*
     * And the panel must only fire it after a confirmed write, never on the attempt.
     *
     * ⚠ ASSERTED BY ORDER, NOT BY A REGEX WINDOW. The first version of this matched
     * `ok: true … onSent?.()` within 400 characters and failed the moment a comment
     * was written between them — a test that breaks on how far apart two lines sit is
     * measuring formatting, not behaviour. Position is the actual claim: the call
     * happens after the success branch and before the catch.
     */
    const okIdx = PROPOSE.indexOf('ok: true,')
    const sentIdx = PROPOSE.indexOf('onSent?.()')
    const catchIdx = PROPOSE.indexOf('} catch {')
    expect(okIdx).toBeGreaterThan(-1)
    expect(sentIdx).toBeGreaterThan(okIdx)
    expect(catchIdx).toBeGreaterThan(sentIdx)
  })

  it('⚠ the refetch skips the 5s share window, or it reads a response older than the write', () => {
    /*
     * `fetchTradesPanel` collapses reads inside 5s so the inbox and the league strip
     * make one request. Correct on load; wrong straight after a write, because the
     * cached response is exactly the state the write just changed.
     */
    expect(INBOX).toContain('reloadToken > 0 ? { force: true } : undefined')
  })
})

describe('🛑 rebuilding a NATIVE offer to counter it keeps the identifiers', () => {
  /*
   * The whole reason this converter exists beside `toPickedAssets` rather than
   * reusing it. That one reads a PROVIDER offer, where the only id is a Sleeper id
   * we deliberately do not pass on — so it rebuilds players by NAME and drops picks
   * outright. Priced fine, unsendable.
   *
   * A counter has to survive `reconcileProposal`, which matches players against the
   * roster and picks by stored pick id. Rebuild by name and every counter comes back
   * as a partial deal the propose panel then refuses — a button that looks wired and
   * never completes.
   */
  const RECEIVER = 'roster-me'
  const PROPOSER = 'roster-them'

  const items = [
    { itemType: 'player', itemReference: 'p-mine', fromRosterId: RECEIVER, toRosterId: PROPOSER, metadata: { playerName: 'Kenneth Walker', position: 'RB', team: 'SEA' } },
    { itemType: 'player', itemReference: 'p-theirs', fromRosterId: PROPOSER, toRosterId: RECEIVER, metadata: { playerName: 'Deebo Samuel', position: 'WR' } },
    { itemType: 'future_pick', itemReference: 'pick-77', fromRosterId: PROPOSER, toRosterId: RECEIVER, metadata: { playerName: '2027 round 2', pickYear: 2027, pickRound: 2 } },
    { itemType: 'faab', itemReference: null, fromRosterId: RECEIVER, toRosterId: PROPOSER, faabAmount: 12, metadata: {} },
  ]

  it('splits give and get from the RECEIVER’s side, not the proposer’s', () => {
    // Countering means answering, so the board must open as the answerer sees it.
    const { give, get } = nativeItemsToAssets(items, RECEIVER)
    expect(give.map((a) => (a.kind === 'player' ? a.name : a.kind))).toEqual(['Kenneth Walker', 'faab'])
    expect(get.map((a) => (a.kind === 'player' ? a.name : a.kind))).toEqual(['Deebo Samuel', 'pick'])
  })

  it('🛑 carries playerId from itemReference — a name would not reconcile', () => {
    const { get } = nativeItemsToAssets(items, RECEIVER)
    expect(get[0]).toMatchObject({ kind: 'player', playerId: 'p-theirs', name: 'Deebo Samuel', position: 'WR' })
  })

  it('🛑 carries pickId, which is the only thing that makes a pick proposable', () => {
    /*
     * TradeAssetPicker says it outright: a hand-typed year and round "can be priced
     * but never proposed — the trade engine matches a pick by its stored id". Drop
     * the id and the counter silently loses the pick.
     */
    const { get } = nativeItemsToAssets(items, RECEIVER)
    const pick = get.find((a) => a.kind === 'pick')
    expect(pick).toMatchObject({ kind: 'pick', pickId: 'pick-77', year: 2027, round: 2, itemType: 'future_pick' })
  })

  it('keeps FAAB as an amount rather than turning it into a player', () => {
    const { give } = nativeItemsToAssets(items, RECEIVER)
    expect(give.find((a) => a.kind === 'faab')).toEqual({ kind: 'faab', amount: 12 })
  })

  it('⚠ ignores an item touching neither roster instead of guessing a side', () => {
    // Three-way rows should not silently land on the answerer's board.
    const { give, get } = nativeItemsToAssets(
      [{ itemType: 'player', itemReference: 'p-other', fromRosterId: 'roster-c', toRosterId: 'roster-d', metadata: {} }],
      RECEIVER,
    )
    expect(give).toEqual([])
    expect(get).toEqual([])
  })

  it('[control] the converter is reached and can differ — swapping perspective swaps the sides', () => {
    /*
     * Without this, every assertion above would also hold for a converter that
     * ignored `receiverRosterId` entirely and always bucketed the same way.
     */
    const asReceiver = nativeItemsToAssets(items, RECEIVER)
    const asProposer = nativeItemsToAssets(items, PROPOSER)
    expect(asProposer.give.map((a) => (a.kind === 'player' ? a.name : a.kind))).toEqual(
      asReceiver.get.map((a) => (a.kind === 'player' ? a.name : a.kind)),
    )
  })
})

describe('⚠ the analyze call was failing zod before any analysis ran', () => {
  it('sends the two fields the route requires and has no default for', () => {
    /*
     * `strategy` and `teamContext` carry no `.default()` in
     * app/api/trade-value/analyze/route.ts. Omitting them returns 400, so the
     * button looked wired and never was.
     */
    expect(CENTER).toContain("strategy: 'neutral',")
    expect(CENTER).toContain("teamContext: 'my_team',")
  })

  it('still posts to the existing route rather than a new one', () => {
    expect(CENTER).toContain("'/api/trade-value/analyze'")
    /*
     * ⚠ ASSERTS THAT THE INBOX READS THE PANEL, NOT WHERE THE URL LITERAL LIVES. This pinned
     * '/api/league/trades-panel?leagueId=' in this file; the literal moved into the shared
     * `tradesPanelFetch` module — which reads the SAME existing route, so the rule this test
     * exists for is untouched — and the assertion went red on a refactor it does not care about.
     * Third time tonight a test has broken on the location of a string rather than on behaviour.
     */
    expect(INBOX).toMatch(/fetchTradesPanel\(|\/api\/league\/trades-panel/)
  })
})
