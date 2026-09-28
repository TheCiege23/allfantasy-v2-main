/**
 * The trade offer as a DM message: its plain-text body (what every surface can show) and its
 * card (what the conversation panel renders from metadata).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  buildTradeOfferMessageText,
  buildTradeStatusMessageText,
  readTradeOffer,
  readTradeOfferStatus,
  safeTradeHref,
  tradeOfferHrefFor,
  type TradeOfferCard,
} from '@/lib/chat-notifications/tradeOfferCard'
import { TradeCardView } from '@/components/core-app/comms/TradeCardView'

const CARD: TradeOfferCard = {
  v: 1,
  source: 'native',
  tradeId: 'trade-1',
  leagueId: 'L1',
  leagueName: 'Pirate League',
  proposer: { manager: 'Dana', team: 'Dana Dynasty', gives: [{ label: 'Nico Collins', detail: 'WR · HOU' }, { label: '2027 Round 1 pick' }] },
  receiver: { manager: 'Bob', team: null, gives: [{ label: 'C.J. Stroud', detail: 'QB · HOU' }] },
  note: 'Fair for both of us?',
  status: 'pending',
  href: '/league/L1?view=trades&tradeId=trade-1',
  hrefs: null,
  directionKnown: true,
  answerOn: null,
  createdAt: '2026-09-25T18:00:00.000Z',
}

describe('the plain-text body stands on its own', () => {
  it('names both managers, what each side gives, and the note', () => {
    const text = buildTradeOfferMessageText(CARD)
    expect(text).toContain('Trade offer in Pirate League: Dana sent Bob a deal.')
    expect(text).toContain('Dana gives: Nico Collins (WR · HOU), 2027 Round 1 pick.')
    expect(text).toContain('Bob gives: C.J. Stroud (QB · HOU).')
    expect(text).toContain('Note: "Fair for both of us?"')
    expect(text).toContain('Open the trade to accept, counter or decline.')
  })

  it('an imported offer says where to answer it, and a Yahoo one claims no direction', () => {
    const text = buildTradeOfferMessageText({ ...CARD, source: 'yahoo', answerOn: 'yahoo', directionKnown: false, note: null })
    expect(text).toContain('Trade offer pending on Yahoo in Pirate League between Dana and Bob.')
    expect(text).not.toContain('sent Bob a deal')
    expect(text).toContain('Answer it on Yahoo')
  })

  it('status lines', () => {
    expect(buildTradeStatusMessageText({ status: 'accepted', actorName: 'Bob' })).toBe('Bob accepted the trade.')
    expect(buildTradeStatusMessageText({ status: 'rejected', actorName: 'The commissioner' })).toBe('The commissioner declined the trade.')
    expect(buildTradeStatusMessageText({ status: 'countered', actorName: 'Bob' })).toBe('Bob countered — the new offer is below.')
    expect(buildTradeStatusMessageText({ status: 'cancelled', proposerName: 'Dana' })).toBe('Dana pulled the trade offer.')
    expect(buildTradeStatusMessageText({ status: 'accepted', answerOn: 'sleeper' })).toBe('Trade accepted on Sleeper.')
    expect(
      buildTradeStatusMessageText({ status: 'accepted', actorName: 'Bob', detail: 'It goes to commissioner review before it processes.' }),
    ).toBe('Bob accepted the trade. It goes to commissioner review before it processes.')
  })
})

describe('reading metadata back (untrusted JSON)', () => {
  it('round-trips a card', () => {
    expect(readTradeOffer({ tradeOffer: JSON.parse(JSON.stringify(CARD)) })).toMatchObject({
      tradeId: 'trade-1',
      proposer: { manager: 'Dana' },
      receiver: { manager: 'Bob' },
      status: 'pending',
    })
  })

  it('a malformed card is null, not a throw', () => {
    expect(readTradeOffer({ tradeOffer: { tradeId: 'x' } })).toBeNull()
    expect(readTradeOffer({ tradeOffer: 'nope' })).toBeNull()
    expect(readTradeOffer(null)).toBeNull()
    expect(readTradeOffer({ tradeOffer: { ...CARD, source: 'espn' } })).toBeNull()
  })

  it('🛑 only same-origin paths survive as links', () => {
    expect(safeTradeHref('/league/L1?view=trades')).toBe('/league/L1?view=trades')
    expect(safeTradeHref('//evil.example/x')).toBeNull()
    expect(safeTradeHref('javascript:alert(1)')).toBeNull()
    expect(safeTradeHref('https://evil.example')).toBeNull()
    expect(readTradeOffer({ tradeOffer: { ...CARD, href: 'javascript:alert(1)' } })?.href).toBeNull()
  })

  it('an imported offer links each manager to their OWN copy of the league', () => {
    const card = { ...CARD, hrefs: { uA: '/core/trades?league=af-A&trade=T1', uB: '/core/trades?league=af-B&trade=T1' } }
    expect(tradeOfferHrefFor(card, 'uB')).toBe('/core/trades?league=af-B&trade=T1')
    expect(tradeOfferHrefFor(card, 'someone-else')).toBe(CARD.href)
  })

  it('a status note reads back', () => {
    expect(readTradeOfferStatus({ tradeOfferStatus: { source: 'native', tradeId: 'trade-1', status: 'accepted', href: '/x' } })).toEqual({
      source: 'native',
      tradeId: 'trade-1',
      status: 'accepted',
      href: '/x',
    })
    expect(readTradeOfferStatus({ tradeOfferStatus: { source: 'native', tradeId: 'trade-1', status: 'maybe' } })).toBeNull()
  })
})

describe('TradeCardView — OFFER variant, dispatched from the message metadata', () => {
  it('renders both teams, what each gives, the note, the status and "Open trade"', () => {
    render(<TradeCardView metadata={{ tradeOffer: CARD }} />)
    expect(screen.getByText('Trade offer from Dana')).toBeTruthy()
    expect(screen.getByText('Dana · Dana Dynasty gives')).toBeTruthy()
    expect(screen.getByText('Bob gives')).toBeTruthy()
    expect(screen.getByText('Nico Collins (WR · HOU)')).toBeTruthy()
    expect(screen.getByText('C.J. Stroud (QB · HOU)')).toBeTruthy()
    expect(screen.getByText('“Fair for both of us?”')).toBeTruthy()
    expect(screen.getByTestId('trade-offer-status').textContent).toBe('Pending')
    const link = screen.getByText('Open trade') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/league/L1?view=trades&tradeId=trade-1')
  })

  it('the viewer gets their own link on an imported offer', () => {
    const card = { ...CARD, answerOn: 'sleeper' as const, hrefs: { uB: '/core/trades?league=af-B&trade=T1' } }
    render(<TradeCardView metadata={{ tradeOffer: card }} viewerUserId="uB" />)
    expect((screen.getByText('Open trade') as HTMLAnchorElement).getAttribute('href')).toBe('/core/trades?league=af-B&trade=T1')
    expect(screen.getByTestId('trade-offer-status').textContent).toBe('Pending · answer on Sleeper')
  })

  it('an answered offer shows its new status', () => {
    render(<TradeCardView metadata={{ tradeOffer: { ...CARD, status: 'accepted' } }} />)
    expect(screen.getByTestId('trade-offer-status').textContent).toBe('Accepted')
  })

  it('a status follow-up renders as a short line', () => {
    const { container } = render(
      <TradeCardView metadata={{ tradeOfferStatus: { source: 'native', tradeId: 'trade-1', status: 'rejected', href: '/league/L1?view=trades' } }} />,
    )
    expect(container.textContent).toContain('Trade declined')
  })

  it('the completed-trade card still renders exactly as before when only `card` is given', () => {
    render(
      <TradeCardView
        card={{ manager: 'Dana', gave: [{ id: 'p1', name: 'Nico Collins' }], got: [], picksGave: 0, picksGot: 1, season: 2026, week: 3 }}
      />,
    )
    expect(screen.getByText(/Dana made a trade/)).toBeTruthy()
    expect(screen.getByText('1 pick')).toBeTruthy()
  })

  it('nothing to show renders nothing — safe to call for every message', () => {
    const { container } = render(<TradeCardView metadata={{ gif: { url: 'x' } }} />)
    expect(container.innerHTML).toBe('')
  })
})
