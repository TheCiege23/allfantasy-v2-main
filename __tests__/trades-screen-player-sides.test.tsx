import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import Trades from '@/components/core-app/screens/Trades'
import type { TradesData, TradeRecord } from '@/lib/core-app/trades'

/*
 * The trade card's player sides — who received what, and who is named for it.
 *
 * ⚠ WHY THIS SUITE EXISTS. The Trades screen had NO test at all, and the sides
 * are the newest and least obvious thing on it. They also went through two wrong
 * versions first: shipped as counts (because the file's own header wrongly said
 * identities were not stored), then as an unordered set (because the same
 * comment wrongly said direction was unrecoverable, while naming the join that
 * recovers it). A third regression would be very easy and completely silent.
 *
 * ⚠ AND `manager: null` IS A REAL CASE, NOT A DEFENSIVE BRANCH.
 * `LeagueTradeHistory.sleeperUsername` is a numeric Sleeper USER id; measured on
 * production it maps to `LeagueTeam.platformUserId` on 3,413 of 4,362 histories
 * (78%) and to `externalId` on ZERO. So roughly a fifth of sides genuinely
 * cannot be named, and the one thing they must never do is print the raw id.
 */

function record(over: Partial<TradeRecord> = {}): TradeRecord {
  return {
    transactionId: 'tx-1',
    season: 2026,
    week: 1,
    rosterIds: ['1', '2'],
    yourSide: 'in',
    playersIn: 1,
    playersOut: 2,
    picks: 0,
    partnerTeamName: 'Gridiron Vultures',
    at: new Date('2026-09-05T22:16:13Z'),
    players: [
      {
        manager: 'Your Team',
        isYou: true,
        received: [{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }],
      },
      {
        manager: 'Gridiron Vultures',
        isYou: false,
        received: [
          { sleeperId: '9509', name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
          { sleeperId: '4034', name: 'Christian McCaffrey', position: 'RB', team: 'SF' },
        ],
      },
    ],
    ...over,
  }
}

function data(trades: TradeRecord[]): TradesData {
  return {
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper' },
    gradingContext: { available: false, reason: 'no grading context' },
    history: { available: true, data: trades },
    inbox: { available: false, reason: 'not ingested' },
    sent: { available: false, reason: 'not ingested' },
    grades: { available: false, reason: 'nothing priced' },
    deadline: { available: false, reason: 'no deadline on file' },
  }
}

describe('trades screen — directional player sides', () => {
  it('names BOTH sides by the manager who received', () => {
    render(<Trades data={data([record()])} />)
    expect(screen.getByText('You got')).toBeTruthy()
    expect(screen.getByText('Gridiron Vultures got')).toBeTruthy()
  })

  it('makes every received player a control that opens the card', () => {
    render(<Trades data={data([record()])} />)
    for (const name of ['Jahmyr Gibbs', 'Bijan Robinson', 'Christian McCaffrey']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.className).toContain('af-pc-trigger')
    }
  })

  /*
   * The direction assertion proper: Gibbs must be under YOUR side and the other
   * two under theirs. A regression that flattens the sides back into one list
   * would still render all three names, so asserting names alone proves nothing.
   */
  it('puts each player under the side that actually received him', () => {
    const { container } = render(<Trades data={data([record()])} />)
    const sides = [...container.querySelectorAll('.af-tr-players-side')]
    expect(sides).toHaveLength(2)

    const readSide = (el: Element) => ({
      who: el.querySelector('.af-tr-players-who')?.textContent ?? '',
      got: [...el.querySelectorAll('button.af-pc-trigger')].map((b) => b.textContent),
    })
    const yours = sides.map(readSide).find((s) => s.who === 'You got')
    const theirs = sides.map(readSide).find((s) => s.who === 'Gridiron Vultures got')

    expect(yours?.got).toEqual(['Jahmyr Gibbs'])
    expect(theirs?.got).toEqual(['Bijan Robinson', 'Christian McCaffrey'])
  })

  it('marks your own side so it can be found at a glance', () => {
    const { container } = render(<Trades data={data([record()])} />)
    const mine = container.querySelector('.af-tr-players-who[data-you="true"]')
    expect(mine?.textContent).toBe('You got')
  })

  /* ~22% of sides cannot be named. They must never print the raw Sleeper id. */
  it('renders an unresolved manager as "Another manager", never a raw id', () => {
    const { container } = render(
      <Trades
        data={data([
          record({
            players: [
              {
                manager: null,
                isYou: false,
                received: [{ sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }],
              },
            ],
          }),
        ])}
      />
    )
    expect(screen.getByText('Another manager got')).toBeTruthy()
    expect(container.textContent).not.toContain('411273464511479808')
    expect(container.querySelector('.af-tr-players-who')?.textContent).not.toMatch(/^\d+ got$/)
  })

  it('renders no side block at all when the join found nothing', () => {
    const { container } = render(<Trades data={data([record({ players: [] })])} />)
    expect(container.querySelector('.af-tr-players')).toBeNull()
    // ...but the trade itself is still listed, from its counts.
    expect(screen.getByText('with Gridiron Vultures')).toBeTruthy()
  })
})
