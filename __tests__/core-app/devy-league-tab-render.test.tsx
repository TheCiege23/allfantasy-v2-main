import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DevyLeagueTab, { type DevyLeagueTabProps } from '@/components/core-app/screens/DevyLeagueTab'

/**
 * The per-league Devy tab, rendered from the loader's shape.
 *
 * Two things this pins that were false before: an empty free-agent list used to read "Every tracked
 * prospect in this league is rostered." whatever the reason, and the trade-value note said the numbers
 * were "this league's scoring applied to a college projection, not a market price" — the opposite of
 * what `devyOptionValue` is.
 */

const BASE: DevyLeagueTabProps = {
  viewState: 'populated',
  leagueName: 'Campus Kings',
  slots: [],
  freeAgents: [],
  draftRoundLabel: 'Best available',
  draftCountdown: null,
  draftBoard: [],
  news: [],
  tradeValues: [],
}

function tab(props: Partial<DevyLeagueTabProps>) {
  return render(<DevyLeagueTab {...BASE} {...props} />)
}

describe('DevyLeagueTab — populated with real rows', () => {
  it('draws my filled slots, the pool, the ADP board, news and the grade’s values with its basis', () => {
    tab({
      slots: [
        { id: 'devy-p1', player: { name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', headshotUrl: null, teamColor: null } },
        { id: 'slot-1', player: null },
      ],
      freeAgents: [{ id: 'fa1', name: 'Bryce Underwood', position: 'QB', school: 'Michigan', grade: 88.4, headshotUrl: null }],
      draftRoundLabel: 'Best available by ADP',
      draftProspects: [{ id: 'a1', adp: 1.25, name: 'Arch Manning', position: 'QB', school: 'Texas' }],
      draftBoardNote: 'No devy draft order is set in this league, so this is the best available by devy ADP (Fantrax, PPR).',
      news: [{ id: 'n1', kind: 'breakout', player: 'Jeremiah Smith', blurb: 'Three scores again', age: '2h ago' }],
      tradeValues: [
        { id: 'p1', player: 'Jeremiah Smith', value: 4321.4, trend: null, status: 'Rostered · You' },
        { id: 'p2', player: 'Unmeasured End', value: null, trend: null, status: 'Rostered · Gridiron Gang' },
      ],
      tradeValueNote: 'College prospects are priced as options on an NFL career.',
      emptyReasons: { slots: 'should not render — a slot is filled' },
    })

    expect(screen.getByText('1 of 2 filled')).toBeTruthy()
    expect(screen.getAllByText('Jeremiah Smith').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('should not render — a slot is filled')).toBeNull()
    expect(screen.getByText('Bryce Underwood')).toBeTruthy()
    expect(screen.getByText(/QB · Michigan · 88 grade/)).toBeTruthy()
    expect(screen.getByText('ADP 1.3')).toBeTruthy()
    expect(screen.getByText('Arch Manning')).toBeTruthy()
    expect(screen.getByText(/Devy draft board · Best available by ADP/)).toBeTruthy()
    expect(screen.getByText(/best available by devy ADP \(Fantrax, PPR\)/)).toBeTruthy()
    expect(screen.getByText('Three scores again')).toBeTruthy()
    expect(screen.getByText('4321')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getAllByTitle('No trend measured')).toHaveLength(2)
    expect(screen.queryByTitle('Flat')).toBeNull()
    expect(screen.getByText('College prospects are priced as options on an NFL career.')).toBeTruthy()
    expect(screen.queryByText(/not a\s+market price/)).toBeNull()
  })

  it('renders a live draft order in place of the ADP board', () => {
    tab({
      draftRoundLabel: 'Round 2',
      draftCountdown: 'Live',
      draftBoard: [
        { id: 'pick-4', label: 'R2 · P1', team: 'Charlie', status: 'drafted', selection: 'Arch Manning · QB' },
        { id: 'pick-5', label: 'R2 · P2', team: 'Bravo', status: 'on-the-clock', selection: null },
      ],
      draftProspects: [{ id: 'a1', adp: 3, name: 'Should Not Show', position: 'WR', school: 'X' }],
    })
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('Arch Manning · QB')).toBeTruthy()
    expect(screen.getByText('On the clock')).toBeTruthy()
    expect(screen.queryByText('Should Not Show')).toBeNull()
  })
})

describe('DevyLeagueTab — every empty section says why', () => {
  it('🛑 shows the loader’s reasons, and never claims everyone is rostered', () => {
    tab({
      slots: [{ id: 'slot-0', player: null }],
      emptyReasons: {
        slots: 'No devy rights are recorded for your team here.',
        freeAgents: 'The college prospect pool couldn’t be read just now.',
        draftBoard: 'No devy draft is scheduled in this league.',
        news: 'College news was last updated 6d ago, which is too old to show as current.',
        tradeValues: 'No prospect is held in this league yet.',
      },
    })
    expect(screen.getByText('No devy rights are recorded for your team here.')).toBeTruthy()
    expect(screen.getByText('The college prospect pool couldn’t be read just now.')).toBeTruthy()
    expect(screen.getByText('No devy draft is scheduled in this league.')).toBeTruthy()
    expect(screen.getByText('College news was last updated 6d ago, which is too old to show as current.')).toBeTruthy()
    expect(screen.getByText('No prospect is held in this league yet.')).toBeTruthy()
    expect(screen.queryByText(/Every tracked prospect in this league is rostered/)).toBeNull()
    // No empty table shell under a reason.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('without reasons, falls back to copy that claims nothing it cannot know', () => {
    tab({})
    expect(screen.getByText('No unrostered prospects to show.')).toBeTruthy()
    expect(screen.queryByText(/Every tracked prospect/)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
