import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SleeperCheck } from '@/components/sleeper-check/SleeperCheck'

const RESULT = {
  ok: true,
  status: 'ok',
  username: 'guap',
  displayName: 'Guap',
  avatarId: null,
  season: '2026',
  asOf: '2026-10-25T16:10:00.000Z',
  leagues: [
    { leagueId: 'L1', name: 'KBFL', bestBall: false, read: true },
    { leagueId: 'BB', name: 'Best Ball Mania', bestBall: true, read: true },
  ],
  leaguesNotShown: 0,
  leaguesDeferred: 0,
  leaguesUnavailable: 0,
  players: [
    {
      sleeperId: 'kincaid', name: 'Dalton Kincaid', position: 'TE', team: 'BUF', imageUrl: null, injuryStatus: 'Out', severity: 'out',
      leagues: [{ leagueId: 'L1', slot: 'starter' }, { leagueId: 'BB', slot: 'starter' }], starting: 2, startingSetLineup: 1,
    },
    {
      sleeperId: 'kraft', name: 'Tucker Kraft', position: 'TE', team: 'GB', imageUrl: null, injuryStatus: null, severity: null,
      leagues: [{ leagueId: 'L1', slot: 'bench' }], starting: 0, startingSetLineup: 0,
    },
  ],
  alerts: [] as unknown[],
}
RESULT.alerts = [RESULT.players[0]]

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => RESULT })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/check — the public Sleeper check', () => {
  it('a shared ?u= link runs the check on load, without claiming a form fill time', async () => {
    render(<SleeperCheck initialUsername="guap" />)
    await screen.findByText('In a lineup, and hurt')
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
    expect(body).toEqual({ username: 'guap', website: '' })
  })

  it('one search is one lookup — the ?u= re-render that follows it never runs a second', async () => {
    // Writing ?u= makes Next refetch the server component, which re-renders with the new username.
    const { rerender } = render(<SleeperCheck initialUsername="" />)
    fireEvent.change(screen.getByLabelText('Sleeper username'), { target: { value: 'guap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check my leagues' }))
    await screen.findByText('In a lineup, and hurt')
    rerender(<SleeperCheck initialUsername="guap" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('previews the first eight alerts and shows the rest on request', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      ...RESULT.players[0], sleeperId: `p${i}`, name: `Player ${i}`, leagues: [{ leagueId: 'L1', slot: 'starter' }],
    }))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...RESULT, players: many, alerts: many }) })
    render(<SleeperCheck initialUsername="guap" />)
    await screen.findByText('In a lineup, and hurt')
    expect(document.querySelectorAll('.af-ck-alert')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 11' }))
    expect(document.querySelectorAll('.af-ck-alert')).toHaveLength(11)
  })

  it('leads with the hurt starter and the leagues he starts in — best ball left out', async () => {
    render(<SleeperCheck initialUsername="guap" />)
    const where = await screen.findByText(/Starting in 1 lineup:/)
    expect(where.textContent).toContain('KBFL')
    expect(where.textContent).not.toContain('Best Ball Mania')
  })

  it('sends "sign up to fix" to the Sleeper import, username prefilled', async () => {
    render(<SleeperCheck initialUsername="guap" />)
    const cta = await screen.findByRole('link', { name: 'Sign up to fix lineups' })
    const href = cta.getAttribute('href')!
    expect(href.startsWith('/signup?')).toBe(true)
    expect(new URLSearchParams(href.split('?')[1]).get('next')).toBe('/import?provider=sleeper&username=guap')
  })

  it('filters to injured players, and opens a player to every league he is in', async () => {
    render(<SleeperCheck initialUsername="guap" />)
    await screen.findByText('Every player you roster')
    fireEvent.click(screen.getByRole('button', { name: 'Injured' }))
    expect(screen.queryByRole('button', { name: /Tucker Kraft/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Dalton Kincaid/ }))
    expect(screen.getByText('Best ball')).toBeTruthy()
  })

  it('refuses a malformed username without a request, and shows the server\'s message on a miss', async () => {
    render(<SleeperCheck initialUsername="" />)
    fireEvent.change(screen.getByLabelText('Sleeper username'), { target: { value: 'two words' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check my leagues' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, message: 'No Sleeper account named "ghost".' }) })
    fireEvent.change(screen.getByLabelText('Sleeper username'), { target: { value: 'ghost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check my leagues' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No Sleeper account named "ghost".'))
  })
})
