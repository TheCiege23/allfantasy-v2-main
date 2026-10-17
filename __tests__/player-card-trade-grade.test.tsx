/**
 * The player card draws each trade's grade (2026-09-27).
 *
 * ⚠ RENDERED, NOT GREPPED — `player-card-trades-scope.test.ts` pins that `loadTrades` computes the
 * grade; this pins that the sheet actually draws it: the side that got him, the side that paid, and
 * a withheld grade's reason with no letter. Harness from `player-card-trade-block.test.tsx`.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData, PlayerCardTrade } from '@/lib/core-app/playerCard'

const SECTION_NO = (reason: string) => ({ available: false as const, reason })

type League = NonNullable<PlayerCardData['league']>

const TRADE: PlayerCardTrade = {
  transactionId: 'tx-1',
  platform: 'sleeper',
  leagueName: 'Ice Kings',
  tradeDate: '2026-09-10T12:00:00.000Z',
  acquired: ['Jahmyr Gibbs'],
  sent: ['Bijan Robinson'],
  picks: [],
  grade: { graded: true, acquirerLetter: 'B', senderLetter: 'D', got: 5000, gave: 4000 },
}

function card(trades: PlayerCardTrade[]): PlayerCardData {
  const league: League = {
    leagueId: 'lg-42',
    leagueName: 'Ice Kings',
    platform: 'sleeper',
    slot: 'BENCH',
    isYours: true,
    owner: { teamName: 'Ice Kings', ownerName: 'TheCiege26' },
    price: SECTION_NO('not priced'),
    yourRoster: [],
    trades,
    playoffSchedule: SECTION_NO('no playoff start week on file'),
    watched: false,
    tradeBlock: { supported: true, note: 'note', listed: false, byYou: false, teamName: null, since: null },
  } as League
  return {
    context: 'league',
    player: { externalId: 'sleeper:9221', sleeperId: '9221', sport: 'NFL', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', number: 26, imageUrl: null },
    bio: { age: 24, height: "5'9\"", weight: '200 lb', yearsExp: 2, college: 'Alabama' },
    market: SECTION_NO('not priced'),
    ownership: SECTION_NO('too few leagues'),
    schedule: SECTION_NO('no fixtures'),
    byeWeek: null,
    trades: SECTION_NO('no trades'),
    comps: SECTION_NO('no comps'),
    news: SECTION_NO('no news'),
    injury: SECTION_NO('No injury designation reported in the last 14 days.'),
    insight: null,
    league,
  } as PlayerCardData
}

function mount(data: PlayerCardData) {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />,
  )
}

describe('player card — trade grade', () => {
  it('draws the letter for the side that got him and the side that paid, with the values', () => {
    const { container } = mount(card([TRADE]))
    const letters = [...container.querySelectorAll('.af-pc-trade-letter')].map((n) => [n.getAttribute('data-letter'), n.textContent])
    expect(letters).toEqual([
      ['B', 'Got him B'],
      ['D', 'Paid D'],
    ])
    expect(container.querySelector('.af-pc-trade-grade')?.textContent).toContain('5,000 for 4,000 on the league’s values today')
  })

  it('a withheld grade says why and draws no letter', () => {
    const { container } = mount(card([{ ...TRADE, grade: { graded: false, withheld: 'a used pick could not be matched' } }]))
    expect(container.querySelectorAll('.af-pc-trade-letter')).toHaveLength(0)
    expect(container.textContent).toContain('Not graded: a used pick could not be matched')
  })

  it('no grade on the trade: nothing is drawn in its place', () => {
    const { container } = mount(card([{ ...TRADE, grade: null }]))
    expect(container.querySelector('.af-pc-trade-grade')).toBeNull()
    expect(container.textContent).not.toContain('Not graded')
    // The trade itself is still listed.
    expect(container.textContent).toContain('Cost Bijan Robinson')
  })
})
