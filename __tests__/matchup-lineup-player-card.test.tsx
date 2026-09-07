import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData, MatchupPlayerCell } from '@/lib/core-app/matchup'

/*
 * The matchup lineup board's player names, as controls that open the player card.
 *
 * ⚠ WHY THIS SUITE EXISTS, AND IT IS THE INTERESTING PART. The neighbouring
 * suite (`matchup-screen-banner`) renders this screen with
 * `lineups: { available: false }` — deliberately, because it is about the banner
 * — so it never reaches `PlayerHalf` at all. Wiring the card into that component
 * was therefore covered by a passing test suite that could not have failed if the
 * wiring were deleted. Exactly the "green guard over a path nobody runs" this
 * repo keeps finding.
 *
 * ⚠ AND THE `sleeperId` DISTINCTION IS THE WHOLE POINT OF THE THIRD CASE.
 * `MatchupPlayerCell.playerId` is the ROSTER's own id — a Sleeper league maps it
 * to itself, but an ESPN roster holds ESPN ids. Only `sleeperId` is safe to hand
 * a Sleeper-keyed lookup, and it is null exactly when the identity join missed.
 * A name with no `sleeperId` must render as TEXT, not as a button that opens a
 * card for the wrong player or for nobody.
 */

function cell(over: Partial<MatchupPlayerCell> = {}): MatchupPlayerCell {
  return {
    playerId: '9221',
    sleeperId: '9221',
    name: 'Jahmyr Gibbs',
    position: 'RB',
    team: 'DET',
    sport: 'NFL',
    imageUrl: null,
    projected: 21.4,
    actual: null,
    empty: false,
    ...over,
  }
}

function data(slots: MatchupData['lineups']): MatchupData {
  return {
    league: { id: 'l1', name: 'Last League Left', platform: 'sleeper', logoUrl: null, sourceLink: null },
    week: { available: true, data: { week: 1, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'You', ownerName: 'you', record: '0-0', isYou: true, avatarUrl: null },
        opponent: { teamName: 'Them', ownerName: 'them', record: '0-0', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'unplayed week' },
    lineups: slots,
    identityNote: null,
    playerScoring: { available: false, reason: 'no per-player scoring' },
    winProbability: { available: false, reason: 'no probability' },
    projectedFinal: {
      available: true,
      data: { you: 100, opponent: 90, unprojected: { you: 0, opponent: 0 } },
    },
    yetToPlay: { available: false, reason: 'no game state' },
  }
}

describe('matchup lineup — player names open the card', () => {
  it('renders a resolved player name as a button', () => {
    render(
      <Matchup
        data={data({ available: true, data: [{ slotLabel: 'RB', you: cell(), opponent: null }] })}
      />
    )
    const btn = screen.getByRole('button', { name: 'Jahmyr Gibbs' })
    expect(btn).toBeTruthy()
    expect(btn.className).toContain('af-pc-trigger')
  })

  it('renders BOTH columns, so an opponent is inspectable too', () => {
    render(
      <Matchup
        data={data({
          available: true,
          data: [
            {
              slotLabel: 'RB',
              you: cell(),
              opponent: cell({ playerId: '9509', sleeperId: '9509', name: 'Bijan Robinson' }),
            },
          ],
        })}
      />
    )
    expect(screen.getByRole('button', { name: 'Jahmyr Gibbs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bijan Robinson' })).toBeTruthy()
  })

  /*
   * The one that would actually catch a regression: an ESPN-style row whose id
   * never resolved to a Sleeper id. It has a NAME (so it is not an empty slot)
   * but nothing to look up.
   */
  it('renders a name with no sleeperId as plain text, never a button', () => {
    render(
      <Matchup
        data={data({
          available: true,
          data: [
            {
              slotLabel: 'WR',
              you: cell({ playerId: 'espn-3139477', sleeperId: null, name: 'Lamar Jackson' }),
              opponent: null,
            },
          ],
        })}
      />
    )
    expect(screen.getByText('Lamar Jackson')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lamar Jackson' })).toBeNull()
  })

  it('leaves an empty starting slot as a hole, with no player control', () => {
    render(
      <Matchup
        data={data({
          available: true,
          data: [
            {
              slotLabel: 'TE',
              you: cell({ empty: true, name: null, sleeperId: null, projected: null }),
              opponent: null,
            },
          ],
        })}
      />
    )
    expect(screen.getByText('Slot empty')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Gibbs/ })).toBeNull()
  })
})
