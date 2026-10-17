import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TradeVisual } from '@/components/core-app/player-finder/TradeVisual'
import type { PlayerTradeVisual } from '@/lib/core-app/playerTradeVisual'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

/*
 * The trade visual, drawn from the loader's output: give on the left, get on
 * the right, the fairness band, the engine's verdict, the alternatives, and
 * the hand-off to the platform inside the card.
 */

const KINCAID = { kind: 'player' as const, playerId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 }
const POLLARD = { kind: 'player' as const, playerId: 'rb3', name: 'Tony Pollard', position: 'RB', value: 3140 }
const STEVENSON = { kind: 'player' as const, playerId: 'rb4', name: 'Rhamondre Stevenson', position: 'RB', value: 2610 }

const G_EVEN = {
  available: true as const,
  data: { letter: 'C' as const, partnerLetter: 'C' as const, label: 'Even', recommendation: 'Fair deal — worth sending.', giveValue: 3100, getValue: 3050, basis: 'Keeper · 1QB · 12 teams · Half PPR' },
}
const G_EDGE = {
  available: true as const,
  data: { letter: 'B' as const, partnerLetter: 'D' as const, label: 'Slightly favors you', recommendation: 'You come out ahead.', giveValue: 2600, getValue: 3050, basis: 'Keeper · 1QB · 12 teams · Half PPR' },
}
const P1 = { id: 'p1', give: [POLLARD], receive: [KINCAID], giveTotal: 3140, receiveTotal: 3010, delta: -130, fairness: 'balanced' as const, confidence: 85, reasons: ['Fills one of your roster needs'], warnings: [], grade: G_EVEN }
const P2 = { id: 'p2', give: [STEVENSON], receive: [KINCAID], giveTotal: 2610, receiveTotal: 3010, delta: 400, fairness: 'slight edge you' as const, confidence: 85, reasons: [], warnings: [], grade: G_EDGE }

const VISUAL: PlayerTradeVisual = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn', platformLeagueId: '888', season: 2026,
  target: { sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 },
  you: { teamName: 'Cafe Con Chimmy', ownerName: 'guap', externalId: '2', stance: 'contender', needs: ['TE'], surpluses: ['RB'] },
  partner: { teamName: "Tasha's Titans", ownerName: 'tashaR', externalId: '1', stance: 'middle', needs: ['RB'], surpluses: ['TE'] },
  values: { mode: 'redraft', source: 'fantasycalc', fetchedAt: '2026-09-02T12:00:00Z', ppr: 0.5, numQbs: 1, scoringAdjustment: null },
  bidInstead: null,
  packages: [P1, P2],
  recommended: P1,
  grade: G_EVEN,
}

describe('TradeVisual', () => {
  /*
   * 🛑 ONE VERDICT (2026-09-29). The card printed the finder's fairness band AND a second engine's
   * "Engine: accept/reject", starter points and acceptance odds — none of them the letter the Trade
   * Center gives the same deal. Asserted both ways: the one grade is there, the others are not.
   */
  it('prints the one trade grade and nothing from any other model', () => {
    render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    expect(screen.getByText('C · Even')).toHaveAttribute('data-tone', 'good')
    expect(screen.getByText('Fair deal — worth sending.')).toBeInTheDocument()
    expect(screen.queryByText(/^Engine/)).not.toBeInTheDocument()
    expect(screen.queryByText(/starter pts/)).not.toBeInTheDocument()
    expect(screen.queryByText(/likely to accept/)).not.toBeInTheDocument()
    expect(screen.queryByText('balanced')).not.toBeInTheDocument()
    expect(screen.queryByText('slight edge you')).not.toBeInTheDocument()
  })

  it('an overpay reads as a warning, a big one as bad', () => {
    const d = { available: true as const, data: { ...G_EVEN.data, letter: 'D' as const, label: 'Slightly favors opponent' } }
    const f = { available: true as const, data: { ...G_EVEN.data, letter: 'F' as const, label: 'Major overpay' } }
    const { unmount } = render(<TradeVisual state={{ available: true, data: { ...VISUAL, recommended: { ...P1, grade: d } } }} playerName="Dalton Kincaid" />)
    expect(screen.getByText('D · Slightly favors opponent')).toHaveAttribute('data-tone', 'warn')
    unmount()
    render(<TradeVisual state={{ available: true, data: { ...VISUAL, recommended: { ...P1, grade: f } } }} playerName="Dalton Kincaid" />)
    expect(screen.getByText('F · Major overpay')).toHaveAttribute('data-tone', 'bad')
  })

  it('draws give and get with totals, the one grade, the alternatives, and the hand-off', () => {
    render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    expect(screen.getByRole('heading', { level: 3, name: "What it takes to get Kincaid from Tasha's Titans" })).toBeInTheDocument()

    const give = screen.getByText('You give').closest('.af-pf-tv-side') as HTMLElement
    const get = screen.getByText('You get').closest('.af-pf-tv-side') as HTMLElement
    expect(within(give).getByText('Tony Pollard')).toBeInTheDocument()
    expect(within(give).getByText('3,140', { selector: '.af-pf-tv-total' })).toBeInTheDocument()
    expect(within(get).getByText('Dalton Kincaid')).toBeInTheDocument()
    expect(within(get).getByText('3,010', { selector: '.af-pf-tv-total' })).toBeInTheDocument()

    expect(screen.getByText('C · Even')).toBeInTheDocument()
    expect(screen.getByText('-130 market value to you')).toBeInTheDocument()
    expect(screen.getByText('Fills one of your roster needs')).toBeInTheDocument()

    // The alternative is listed with its own grade, the recommended one is not repeated.
    expect(screen.getByText('Rhamondre Stevenson for Dalton Kincaid')).toBeInTheDocument()
    expect(screen.getByText('B · Slightly favors you')).toBeInTheDocument()
    expect(screen.queryByText('Tony Pollard for Dalton Kincaid')).not.toBeInTheDocument()

    // Hand-off inside the card: the platform, then our own Trade Center.
    // ESPN has no trade URL; the send lands on the partner's team page, where Propose Trade lives.
    expect(screen.getByRole('link', { name: 'Send it on ESPN' })).toHaveAttribute('href', 'https://fantasy.espn.com/football/team?leagueId=888&teamId=1&seasonId=2026')
    expect(screen.getByRole('link', { name: 'Open Trade Center' })).toHaveAttribute('href', '/core/trades?league=L-gang')
    expect(screen.getByText(/AllFantasy never sends a trade/)).toBeInTheDocument()
  })

  /* One game is not a season: the partner's direction waits for the record (2026-09-17). */
  it('says it is too early to tell when the partner stance is not settled', () => {
    const early = { ...VISUAL, partner: { ...VISUAL.partner, stance: 'middle' as const, stanceSettled: false } }
    render(<TradeVisual state={{ available: true, data: early }} playerName="Dalton Kincaid" />)
    expect(screen.getByText(/too early to tell if buying or selling/)).toBeInTheDocument()
  })

  it('names the settled stance as before', () => {
    const settled = { ...VISUAL, partner: { ...VISUAL.partner, stance: 'rebuilder' as const, stanceSettled: true } }
    render(<TradeVisual state={{ available: true, data: settled }} playerName="Dalton Kincaid" />)
    expect(screen.getByText(/· rebuilder/)).toBeInTheDocument()
    expect(screen.queryByText(/too early to tell/)).not.toBeInTheDocument()
  })

  it('says why when the grade could not be taken, keeps the package, and puts no other verdict in its place', () => {
    const miss = { available: false as const, reason: 'the trade grade did not answer in time' }
    render(
      <TradeVisual
        state={{ available: true, data: { ...VISUAL, recommended: { ...P1, grade: miss }, grade: miss } }}
        playerName="Dalton Kincaid"
      />,
    )
    expect(screen.getByText('Grade: the trade grade did not answer in time')).toBeInTheDocument()
    expect(screen.getByText('Tony Pollard')).toBeInTheDocument()
    expect(screen.queryByText('balanced')).not.toBeInTheDocument()
    expect(screen.queryByText('C · Even')).not.toBeInTheDocument()
  })

  it('renders the reason, and nothing invented, when there is no visual', () => {
    render(<TradeVisual state={{ available: false, reason: 'he is already on your roster in this league' }} playerName="Dalton Kincaid" />)
    expect(screen.getByText('he is already on your roster in this league.')).toBeInTheDocument()
    expect(screen.queryByText('You give')).not.toBeInTheDocument()
  })

  it('offers the Trade Center alone when there is no balanced package', () => {
    render(<TradeVisual state={{ available: true, data: { ...VISUAL, packages: [], recommended: null, grade: { available: false, reason: 'no package to grade' } } }} playerName="Dalton Kincaid" />)
    expect(screen.getByText(/No balanced package for Kincaid/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Trade Center' })).toBeInTheDocument()
  })

  /*
   * 🛑 THE PRICES IN THE PAYLOAD ARE ALREADY ADJUSTED. A card that renders them without this line
   * has shown a number the chart does not carry and said nothing about it — which is the exact
   * invisibility `applyFormat` refuses. Asserted in BOTH directions, because a note that is always
   * present is as wrong as one that is never present.
   */
  it('🛑 says when this league’s scoring moved the prices, and stays quiet when it did not', () => {
    const note = 'Adjusted for this league’s own reception rules, which the 0.5 PPR chart cannot express: TE +14.5%.'
    const { unmount } = render(
      <TradeVisual state={{ available: true, data: { ...VISUAL, values: { ...VISUAL.values, scoringAdjustment: note } } }} playerName="Dalton Kincaid" />,
    )
    expect(screen.getByText(new RegExp('TE \\+14\\.5%'))).toBeInTheDocument()
    unmount()

    render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    expect(screen.queryByText(/reception rules/)).not.toBeInTheDocument()
  })

  /*
   * 🛑 A NO-TRADE LEAGUE MUST NOT SEE A TRADE CARD. Every part of the normal card — the give/get
   * columns, the fairness band, "Send it on ESPN" — describes an action the manager cannot take.
   * Rendering them under a caveat is how a caveat gets skimmed.
   */
  it('🛑 a guillotine league gets a BID card, and none of the trade furniture', () => {
    render(
      <TradeVisual
        state={{
          available: true,
          data: {
            ...VISUAL,
            packages: [],
            recommended: null,
            bidInstead: {
              concept: 'guillotine',
              budgetTotal: 1000,
              budgetRemaining: 400,
              marginalValue: 2100,
              shareOfSupply: 2100 / 3300,
              ceilingAtRemaining: 636,
              reason: 'No trades in this league. He reaches waivers only if his owner is chopped. That is against a FULL season budget — we do not hold what anyone has actually spent.',
            },
          },
        }}
        playerName="Dalton Kincaid"
      />,
    )
    expect(screen.getByText('Up to $636')).toBeInTheDocument()
    expect(screen.getByText(/64% of the upgrade value/)).toBeInTheDocument()
    expect(screen.getByText(/FULL season budget/)).toBeInTheDocument()

    // None of the trade furniture.
    expect(screen.queryByText('You give')).not.toBeInTheDocument()
    expect(screen.queryByText('You get')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Send it on ESPN' })).not.toBeInTheDocument()
    expect(screen.queryByText(/AllFantasy never sends a trade/)).not.toBeInTheDocument()
  })

  it('⚠ and a non-upgrade is told so plainly, with no dollar figure at all', () => {
    render(
      <TradeVisual
        state={{
          available: true,
          data: {
            ...VISUAL,
            packages: [],
            recommended: null,
            bidInstead: {
              concept: 'guillotine',
              budgetTotal: 1000,
              budgetRemaining: 400,
              marginalValue: -2205,
              shareOfSupply: 0,
              ceilingAtRemaining: 0,
              reason: 'No trades in this league, and he would not improve your lineup anyway — he does not improve your starting lineup.',
            },
          },
        }}
        playerName="Dalton Kincaid"
      />,
    )
    expect(screen.getByRole('heading', { level: 3, name: /Kincaid would not improve your lineup/ })).toBeInTheDocument()
    expect(screen.queryByText(/Up to \$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/of the upgrade value/)).not.toBeInTheDocument()
  })
})

/*
 * A no-trade league with no bid (a tournament). It used to fall through to "No balanced package for
 * Kincaid right now", which reads as "try again later" in a league that can never send one.
 */
describe('TradeVisual in a league that does not allow trades', () => {
  it('🛑 says so, with the catalog\'s reason, and none of the trade furniture', () => {
    render(
      <TradeVisual
        state={{ available: true, data: { ...VISUAL, packages: [], recommended: null, bidInstead: null, tradesAllowed: false, tradeBan: 'Tournament entries are not rosters that trade with one another.' } }}
        playerName="Dalton Kincaid"
      />,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'This league does not allow trades' })).toBeInTheDocument()
    expect(screen.getByText(/not rosters that trade/)).toBeInTheDocument()
    expect(screen.queryByText(/No balanced package/)).not.toBeInTheDocument()
    expect(screen.queryByText('You give')).not.toBeInTheDocument()
  })

  it('[control] a league that trades still gets the trade card', () => {
    render(<TradeVisual state={{ available: true, data: { ...VISUAL, tradesAllowed: true } }} playerName="Dalton Kincaid" />)
    expect(screen.queryByRole('heading', { level: 3, name: 'This league does not allow trades' })).not.toBeInTheDocument()
    expect(screen.getByText('You give')).toBeInTheDocument()
  })
})
