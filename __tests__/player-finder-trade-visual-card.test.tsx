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

const P1 = { id: 'p1', give: [POLLARD], receive: [KINCAID], giveTotal: 3140, receiveTotal: 3010, delta: -130, fairness: 'balanced' as const, confidence: 85, reasons: ['Values are close — fair starting point'], warnings: [] }
const P2 = { id: 'p2', give: [STEVENSON], receive: [KINCAID], giveTotal: 2610, receiveTotal: 3010, delta: 400, fairness: 'slight edge you' as const, confidence: 85, reasons: [], warnings: [] }

const VISUAL: PlayerTradeVisual = {
  leagueId: 'L-gang', leagueName: 'Gridiron Gang', platform: 'espn', platformLeagueId: '888', season: 2026,
  target: { sleeperId: '10236', name: 'Dalton Kincaid', position: 'TE', value: 3010 },
  you: { teamName: 'Cafe Con Chimmy', ownerName: 'guap', externalId: '2', stance: 'contender', needs: ['TE'], surpluses: ['RB'] },
  partner: { teamName: "Tasha's Titans", ownerName: 'tashaR', externalId: '1', stance: 'middle', needs: ['RB'], surpluses: ['TE'] },
  values: { mode: 'redraft', source: 'fantasycalc', fetchedAt: '2026-09-02T12:00:00Z', ppr: 0.5, numQbs: 1 },
  packages: [P1, P2],
  recommended: P1,
  grade: { available: true, data: { verdict: 'accept', verdictConfidence: 'medium', fairnessScore: 71, fairnessDelta: 120, starterDeltaPts: 2.6, lineupNote: 'Kincaid starts over Otton', acceptance: 0.62, explanations: ['Values within band'] } },
}

describe('TradeVisual', () => {
  it('draws give and get with totals, the band, the engine verdict, and the hand-off', () => {
    render(<TradeVisual state={{ available: true, data: VISUAL }} playerName="Dalton Kincaid" />)
    expect(screen.getByRole('heading', { level: 3, name: "What it takes to get Kincaid from Tasha's Titans" })).toBeInTheDocument()

    const give = screen.getByText('You give').closest('.af-pf-tv-side') as HTMLElement
    const get = screen.getByText('You get').closest('.af-pf-tv-side') as HTMLElement
    expect(within(give).getByText('Tony Pollard')).toBeInTheDocument()
    expect(within(give).getByText('3,140', { selector: '.af-pf-tv-total' })).toBeInTheDocument()
    expect(within(get).getByText('Dalton Kincaid')).toBeInTheDocument()
    expect(within(get).getByText('3,010', { selector: '.af-pf-tv-total' })).toBeInTheDocument()

    expect(screen.getByText('balanced')).toHaveAttribute('data-tone', 'good')
    expect(screen.getByText('-130 value to you')).toBeInTheDocument()
    expect(screen.getByText('Engine: accept · medium')).toHaveAttribute('data-tone', 'good')
    expect(screen.getByText('+2.6 starter pts')).toBeInTheDocument()
    expect(screen.getByText('62% likely to accept')).toBeInTheDocument()

    // The alternative is listed, the recommended one is not repeated.
    expect(screen.getByText('Rhamondre Stevenson for Dalton Kincaid')).toBeInTheDocument()
    expect(screen.queryByText('Tony Pollard for Dalton Kincaid')).not.toBeInTheDocument()

    // Hand-off inside the card: the platform, then our own Trade Center.
    // ESPN has no trade URL; the send lands on the partner's team page, where Propose Trade lives.
    expect(screen.getByRole('link', { name: 'Send it on ESPN' })).toHaveAttribute('href', 'https://fantasy.espn.com/football/team?leagueId=888&teamId=1&seasonId=2026')
    expect(screen.getByRole('link', { name: 'Open Trade Center' })).toHaveAttribute('href', '/core/trades?league=L-gang')
    expect(screen.getByText(/AllFantasy never sends a trade/)).toBeInTheDocument()
  })

  it('says why when the engine could not grade, and keeps the package', () => {
    render(
      <TradeVisual
        state={{ available: true, data: { ...VISUAL, grade: { available: false, reason: 'the trade engine did not answer in time' } } }}
        playerName="Dalton Kincaid"
      />,
    )
    expect(screen.getByText('Engine grade: the trade engine did not answer in time')).toBeInTheDocument()
    expect(screen.getByText('balanced')).toBeInTheDocument()
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
})
