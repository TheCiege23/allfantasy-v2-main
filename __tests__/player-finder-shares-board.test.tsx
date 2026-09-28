import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { LeaguePicker } from '@/components/core-app/player-finder/LeaguePicker'
import { PlayerSharesBoard } from '@/components/core-app/player-finder/PlayerSharesBoard'
import type { PlayerShares } from '@/lib/core-app/playerShares'
import type { LeagueShareView } from '@/lib/core-app/playerSharesLeague'

const row = (id: string, name: string, leagues: number, starts: number, status: PlayerShares['rows'][number]['status'] = null) => ({
  player: { sport: 'NFL', externalId: `x-${id}`, sleeperId: id, name, position: 'WR', team: 'NYG', imageUrl: null },
  leagues,
  starts,
  ir: 0,
  leagueIds: [],
  status,
  description: null,
})
const SHARES: PlayerShares = {
  rows: [row('100', 'Malik Nabers', 9, 8, { tone: 'warn', label: 'Questionable' }), row('300', 'Tyrone Tracy', 4, 1)],
  leaguesRead: 49,
  playersHeld: 612,
  unsupportedLeagues: 1,
}

describe('PlayerSharesBoard', () => {
  it('ranks your most-held players with the share, the starts and the injury, each opening his card', () => {
    render(<PlayerSharesBoard state={{ available: true, data: SHARES }} />)
    const board = screen.getByRole('region', { name: 'Your shares' })
    expect(within(board).getByText(/612 players across 49 rosters · 1 on a platform/)).toBeInTheDocument()
    const items = within(board).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Malik Nabers')
    expect(items[0]).toHaveTextContent('9 of 49')
    expect(items[0]).toHaveTextContent('8 starting')
    expect(within(items[0]).getByText('Questionable')).toBeInTheDocument()
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/core/players?q=Malik%20Nabers&player=NFL%3Ax-100')
  })

  it('in league mode says who has each one there, his value there and his points under its scoring', () => {
    const league: LeagueShareView = {
      leagueId: 'S1',
      leagueName: 'KBFL',
      scoringKnown: true,
      season: 2026,
      cells: {
        '100': { holder: { kind: 'you', slot: 'STARTER' }, value: { value: 4210, base: 4210, fitNote: null, mode: 'redraft', numQbs: 1 }, season: { points: 42.5, games: 3 } },
        '300': { holder: { kind: 'other', teamName: 'Titans', ownerName: 'tasha' }, value: null, season: null },
      },
    }
    render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={league} />)
    const board = screen.getByRole('region', { name: 'Your shares · in KBFL' })
    const [a, b] = within(board).getAllByRole('listitem')
    expect(a).toHaveTextContent('You · starting')
    expect(a).toHaveTextContent('value 4,210')
    expect(a).toHaveTextContent('42.5 pts · 3 games')
    expect(b).toHaveTextContent('@tasha')
    expect(b).toHaveTextContent('no stats yet')
    // The row keeps the league in context.
    expect(within(a).getByRole('link').getAttribute('href')).toContain('&league=S1')
  })

  it('shows the value as AF Pro for a locked viewer, never a number', () => {
    const league: LeagueShareView = { leagueId: 'S1', leagueName: 'KBFL', scoringKnown: true, season: 2026, cells: { '100': { holder: { kind: 'free' }, value: null, season: null } } }
    render(<PlayerSharesBoard state={{ available: true, data: SHARES }} league={league} valuesLocked />)
    expect(screen.getAllByText('value · AF Pro').length).toBeGreaterThan(0)
  })
})

describe('LeaguePicker', () => {
  const LEAGUES = [
    { id: 'L1', name: 'KBFL', platform: 'sleeper' },
    { id: 'L2', name: 'Four Horsemen', platform: 'sleeper' },
    { id: 'L3', name: 'The League', platform: 'espn' },
  ]
  const realLocation = window.location
  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('saves the ticked leagues to the account and reloads', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LeaguePicker leagues={LEAGUES} saved={null} />)
    fireEvent.click(screen.getByRole('button', { name: /Leagues/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /The League/ })) // untick one of three
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ leagueIds: ['L1', 'L2'] })
  })

  it('saves "all" as null, and says how many are picked', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, reload } })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LeaguePicker leagues={LEAGUES} saved={['L1']} />)
    expect(screen.getByRole('button', { name: /Leagues/ })).toHaveTextContent('1 of 3')
    fireEvent.click(screen.getByRole('button', { name: /Leagues/ }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ leagueIds: null })
  })
})
