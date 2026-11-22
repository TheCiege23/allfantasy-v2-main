import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SideContestsCard } from '@/components/league/native/screens/SideContestsCard'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const OFF = { high_score: { enabled: false, prizeCents: 0 }, closest_loss: { enabled: false, prizeCents: 0 } }
const ON = { high_score: { enabled: true, prizeCents: 2000 }, closest_loss: { enabled: true, prizeCents: 1000 } }

const view = (over: Record<string, unknown> = {}) => ({
  native: true,
  canEdit: false,
  config: ON,
  season: 2026,
  weeks: [
    {
      week: 2,
      contests: {
        high_score: [
          { rosterId: 'A', value: 130, prizeCents: 1000, teamName: 'Aces' },
          { rosterId: 'C', value: 130, prizeCents: 1000, teamName: 'Cats' },
        ],
        closest_loss: [{ rosterId: 'D', value: 1.5, prizeCents: 1000, teamName: 'Dogs', opponentRosterId: 'B', opponentName: 'Bees' }],
      },
    },
    { week: 1, contests: { high_score: [{ rosterId: 'A', value: 141.2, prizeCents: 2000, teamName: 'Aces' }] } },
  ],
  totals: [
    { rosterId: 'A', teamName: 'Aces', wins: { high_score: 2, closest_loss: 0 }, prizeCents: 3000 },
    { rosterId: 'C', teamName: 'Cats', wins: { high_score: 1, closest_loss: 0 }, prizeCents: 1000 },
    { rosterId: 'D', teamName: 'Dogs', wins: { high_score: 0, closest_loss: 1 }, prizeCents: 1000 },
  ],
  ...over,
})

function stub(initial: Record<string, unknown>) {
  let current = initial
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      current = { ...current, config: ON }
      return { ok: true, json: async () => ({}) }
    }
    return { ok: true, json: async () => current }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('weekly prizes card', () => {
  it('shows a member the latest week, ties with each share, and the season money', async () => {
    stub(view())
    render(<SideContestsCard leagueId="L" />)
    const [high, earlierHigh] = await screen.findAllByTestId('side-contest-high_score')
    expect(high.textContent).toBe('Weekly high score: Aces and Cats, 130.00 points (tie) · $10 each')
    expect(earlierHigh.textContent).toBe('Weekly high score: Aces, 141.20 points · $20')
    expect(screen.getByTestId('side-contest-closest_loss').textContent).toBe('Closest loss: Dogs, lost by 1.50 to Bees · $10')
    expect(screen.getByTestId('side-contest-totals').textContent).toBe('Aces$30Cats$10Dogs$10')
    expect(screen.getByText('Earlier weeks')).toBeTruthy()
    expect(screen.queryByText('Edit')).toBeNull()
  })

  it('is hidden from members until a contest is on, and outside leagues AllFantasy scores', async () => {
    const fetchMock = stub(view({ config: OFF, weeks: [], totals: [] }))
    const { container } = render(<SideContestsCard leagueId="L" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container.textContent).toBe('')
    cleanup()
    stub(view({ native: false }))
    const second = render(<SideContestsCard leagueId="L" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(second.container.textContent).toBe('')
  })

  it('lets the commissioner set them up and saves both contests in one PUT', async () => {
    const fetchMock = stub(view({ canEdit: true, config: OFF, weeks: [], totals: [] }))
    render(<SideContestsCard leagueId="L" />)
    fireEvent.click(await screen.findByText('Set up'))
    fireEvent.click(screen.getByTestId('side-contest-toggle-high_score'))
    fireEvent.change(screen.getByTestId('side-contest-prize-high_score'), { target: { value: '20' } })
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Saved.')
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/leagues/L/side-contests')
    expect(JSON.parse(String(put[1]!.body))).toEqual({ high_score: { enabled: true, prize: '20' }, closest_loss: { enabled: false, prize: '' } })
    expect(screen.getByText('Winners appear here once the first week is final.')).toBeTruthy()
  })

  it('shows the server\'s refusal and keeps the form open', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? { ok: false, json: async () => ({ error: 'The head commissioner hasn’t given you money permission in this league.' }) }
        : { ok: true, json: async () => view({ canEdit: true }) },
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<SideContestsCard leagueId="L" />)
    fireEvent.click(await screen.findByText('Edit'))
    fireEvent.click(screen.getByText('Save'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/money permission/)
    expect(screen.getByTestId('side-contests-edit')).toBeTruthy()
  })
})
