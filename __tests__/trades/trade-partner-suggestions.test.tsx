import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import {
  TradePartnerSuggestions,
  suggestionToPickedAssets,
} from '@/components/core-app/screens/TradePartnerSuggestions'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import type { PartnerRanking, PartnerRecommendation } from '@/lib/trade-intel/partnerRanking'

const roster = (rosterId: string, over: Partial<LeagueRoster> = {}): LeagueRoster => ({
  rosterId,
  platformUserId: `u-${rosterId}`,
  players: [],
  picks: [],
  teamExternalId: null,
  ownerName: rosterId,
  avatarUrl: null,
  wins: 0,
  losses: 0,
  ties: 0,
  faabRemaining: null,
  canReceiveProposal: false,
  ...over,
})

const partner = (over: Partial<PartnerRecommendation> = {}): PartnerRecommendation => ({
  rosterId: 'A',
  ownerName: 'Alpha',
  rank: 1,
  score: 62,
  label: 'Good fit',
  components: { availability: 0.7, need: 0.4, package: 0.6, history: 0.8 },
  reasons: ['Has a spare RB: Runner (4,600) would start over your weakest RB (800).', 'Second.', 'Third.', 'Fourth, not shown.'],
  suggestion: {
    give: [{ id: 'mine', name: 'Receiver', position: 'WR', value: 4000, kind: 'player' }],
    get: [{ id: 'theirs', name: 'Runner', position: 'RB', value: 4600, kind: 'player' }],
    percentApart: 13,
  },
  ...over,
})

const ranking = (partners: PartnerRecommendation[], gaps: string[] = []): PartnerRanking => ({ partners, gaps })

describe('TradePartnerSuggestions', () => {
  it('renders nothing without a ranking — the chip row still works', () => {
    const { container } = render(
      <TradePartnerSuggestions ranking={null} selectedRosterId={null} onChoose={() => {}} onStartWith={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows the top fits with score, label, three reasons and the deal', () => {
    const { container } = render(
      <TradePartnerSuggestions
        ranking={ranking([partner(), partner({ rosterId: 'B', ownerName: 'Bravo', rank: 2, score: 9, label: 'Weak fit', suggestion: null, reasons: [] }), partner({ rosterId: 'C', rank: 3 }), partner({ rosterId: 'D', ownerName: 'Delta', rank: 4 })])}
        selectedRosterId={null}
        onChoose={() => {}}
        onStartWith={() => {}}
      />,
    )
    const cards = container.querySelectorAll('.af-tc-fit')
    expect(cards).toHaveLength(3)
    expect(screen.queryByText('Delta')).toBeNull()
    const first = cards[0]!
    expect(first.textContent).toContain('Alpha')
    expect(first.textContent).toContain('Good fit')
    expect(first.getAttribute('data-fit')).toBe('good')
    expect(first.querySelector('.af-tc-fit-score')?.textContent).toBe('62/100')
    expect(first.querySelectorAll('.af-tc-fit-reasons li')).toHaveLength(3)
    expect(first.querySelector('.af-tc-fit-deal')?.textContent).toBe('You send Receiver (4,000) · You get Runner (4,600)')
    // No deal, no "start" button — never a control that cannot finish.
    expect(cards[1]!.querySelector('.af-tc-fit-deal')).toBeNull()
    expect([...cards[1]!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Trade with them'])
  })

  it('wires both actions to the partner they belong to', () => {
    const onChoose = vi.fn()
    const onStartWith = vi.fn()
    render(
      <TradePartnerSuggestions ranking={ranking([partner()])} selectedRosterId="A" onChoose={onChoose} onStartWith={onStartWith} />,
    )
    const pressed = screen.getByText('Trading with them')
    expect(pressed.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pressed)
    expect(onChoose).toHaveBeenCalledWith('A')
    fireEvent.click(screen.getByText('Start with this deal'))
    expect(onStartWith.mock.calls[0]![0].rosterId).toBe('A')
  })

  it('prints what the ranking could not see, verbatim', () => {
    render(
      <TradePartnerSuggestions
        ranking={ranking([partner()], ['Trade history is not on file for this league, so past dealing did not count.'])}
        selectedRosterId={null}
        onChoose={() => {}}
        onStartWith={() => {}}
      />,
    )
    expect(screen.getByText('Trade history is not on file for this league, so past dealing did not count.')).toBeTruthy()
  })

  it('says so when nobody could be ranked', () => {
    render(<TradePartnerSuggestions ranking={ranking([])} selectedRosterId={null} onChoose={() => {}} onStartWith={() => {}} />)
    expect(screen.getByText('No other team in this league could be ranked.')).toBeTruthy()
  })
})

describe('suggestionToPickedAssets', () => {
  const mine = roster('V', {
    players: [{ id: 'mine', name: 'Receiver', position: 'WR', team: 'KC', imageUrl: 'https://x/r.png', byeWeek: null, injuryStatus: null, value: 4000, stock: 'up', stockDelta: 120 }],
    picks: [
      { pickId: 'pk1', season: 2027, round: 1, label: '2027 1st', itemType: 'future_pick', value: 1800 },
      { pickId: 'pk2', season: null, round: null, label: 'Mystery pick', itemType: 'future_pick', value: 900 },
    ],
  })
  const theirs = roster('A', {
    players: [{ id: 'theirs', name: 'Runner', position: 'RB', team: 'SF', imageUrl: null, byeWeek: null, injuryStatus: null, value: 4600 }],
  })

  it('rebuilds players and picks from the roster rows, keeping ids a proposal needs', () => {
    const out = suggestionToPickedAssets(
      {
        give: [
          { id: 'mine', name: 'Receiver', position: 'WR', value: 4000, kind: 'player' },
          { id: 'pk1', name: '2027 1st', position: 'PICK', value: 1800, kind: 'pick' },
        ],
        get: [{ id: 'theirs', name: 'Runner', position: 'RB', value: 4600, kind: 'player' }],
        percentApart: 2,
      },
      mine,
      theirs,
    )
    expect(out.dropped).toEqual([])
    expect(out.give).toEqual([
      { kind: 'player', playerId: 'mine', name: 'Receiver', position: 'WR', team: 'KC', value: 4000, imageUrl: 'https://x/r.png', stock: 'up', stockDelta: 120 },
      { kind: 'pick', year: 2027, round: 1, label: '2027 1st', pickId: 'pk1', itemType: 'future_pick', value: 1800 },
    ])
    expect(out.get).toEqual([
      { kind: 'player', playerId: 'theirs', name: 'Runner', position: 'RB', team: 'SF', value: 4600, imageUrl: null, stock: null, stockDelta: null },
    ])
  })

  it('🛑 resolves each side from ITS OWN roster, and drops (and names) what it cannot rebuild', () => {
    const out = suggestionToPickedAssets(
      {
        // "theirs" is not on MY roster, so it cannot be given; the pick has no season/round.
        give: [
          { id: 'theirs', name: 'Runner', position: 'RB', value: 4600, kind: 'player' },
          { id: 'pk2', name: 'Mystery pick', position: 'PICK', value: 900, kind: 'pick' },
        ],
        get: [{ id: 'mine', name: 'Receiver', position: 'WR', value: 4000, kind: 'player' }],
        percentApart: 0,
      },
      mine,
      theirs,
    )
    expect(out.give).toEqual([])
    expect(out.get).toEqual([])
    expect(out.dropped).toEqual(['Runner', 'Mystery pick', 'Receiver'])
  })
})
