import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { LeagueMoveCard } from '@/components/core-app/comms/LeagueMoveCard'
import type { LeagueMove } from '@/lib/league-chat/leagueMoves'

/* A league transaction as a card in league chat (2026-10-31). */
const p = (id: string, name: string, to: string | null = null) => ({ id, name, position: 'RB', team: 'TB', imageUrl: null, to })
const base: LeagueMove = {
  id: 'm1', kind: 'waiver', occurredAt: '2026-10-30T19:14:00Z', teamName: 'Savages13', managerName: 'Savages13', avatarUrl: null,
  involvedTeams: ['Savages13'], adds: [p('a', 'Jordan Addison')], drops: [p('d', 'Tyrone Tracy Jr.')], bid: 14, picks: [],
}

describe('LeagueMoveCard', () => {
  it('names who moved, then one + / − row per player, with the bid on the add', () => {
    render(<LeagueMoveCard move={base} />)
    const card = screen.getByRole('group', { name: /Savages13 made a waiver claim/ })
    expect(within(card).getByText('Jordan Addison').closest('li')!.getAttribute('data-sign')).toBe('add')
    expect(within(card).getByText('Tyrone Tracy Jr.').closest('li')!.getAttribute('data-sign')).toBe('drop')
    expect(within(card).getByText('$14')).toBeTruthy()
    // Not a message: no article for the list's react / reply / pin handling to pick up.
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('draws no bid when it is unknown — never "$0"', () => {
    render(<LeagueMoveCard move={{ ...base, kind: 'roster_move', bid: null }} />)
    expect(screen.getByRole('group', { name: /made a free agent move/ })).toBeTruthy()
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it('groups a trade by who got whom, and never credits an unplaced player to a side', () => {
    const trade: LeagueMove = {
      ...base, kind: 'trade', involvedTeams: ['Fitty SF', 'Versuz'], bid: null, drops: [], picks: ['2027 2nd'],
      adds: [p('b', 'Bucky Irving', 'Fitty SF'), p('j', 'Javonte Williams', 'Versuz'), p('z', 'player 4034')],
    }
    render(<LeagueMoveCard move={trade} />)
    expect(screen.getByText('Fitty SF and Versuz')).toBeTruthy()
    const side = (heading: string) => screen.getByText(heading).closest('section')!
    expect(within(side('Fitty SF gets')).getByText('Bucky Irving')).toBeTruthy()
    expect(within(side('Versuz gets')).getByText('Javonte Williams')).toBeTruthy()
    expect(within(side('Also in this trade')).getByText('player 4034')).toBeTruthy()
    expect(screen.getByText('Picks: 2027 2nd')).toBeTruthy()
  })
})
