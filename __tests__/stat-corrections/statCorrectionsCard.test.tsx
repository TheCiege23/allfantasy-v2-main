import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StatCorrectionsCard } from '@/components/league-settings/home/StatCorrectionsCard'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const side = (rosterId: string, teamName: string, before: number, after: number, applied: number) =>
  ({ rosterId, teamName, before, after, correction: Math.round((after - before) * 100) / 100, applied })

const view = (applied: number) => ({
  covered: true,
  latest: {
    season: 2026, week: 7, checkedAt: '2026-10-22T12:00:00Z', windowClosesAt: '2026-10-26T12:00:00Z', unchecked: 0,
    changes: [{ rosterId: 'A', playerId: 'p', playerName: 'Run Back', position: 'RB', before: 13, after: 8.5, delta: -4.5, teamName: 'Hawks' }],
    matchups: [
      { matchupId: 'm1', resultFlipped: true, home: side('A', 'Hawks', 100, 95.5, applied), away: side('B', 'Owls', 99, 99, 0), fullyApplied: applied === -4.5 },
      { matchupId: 'm2', resultFlipped: false, home: side('C', 'Cats', 80, 81, 0), away: side('D', 'Dogs', 70, 70, 0), fullyApplied: false },
    ],
  },
})

function stub() {
  let applied = 0
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      applied = -4.5
      return { ok: true, json: async () => ({ status: 'ok', week: 7, adjustmentsAdded: 2 }) }
    }
    return { ok: true, json: async () => view(applied) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('stat corrections card', () => {
  it('applies one matchup, says so, reloads, and tells the page to refresh its adjustments', async () => {
    const fetchMock = stub()
    const onApplied = vi.fn()
    render(<StatCorrectionsCard leagueId="L" onApplied={onApplied} />)
    await screen.findByText(/Result changes/)
    expect(screen.getByRole('button', { name: 'Apply all 2' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])
    await screen.findByText('Applied. Scores and standings are updated.')
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ action: 'stat_correction_apply', matchupId: 'm1' })
    await waitFor(() => expect(screen.getByTestId('stat-correction-applied')).toBeTruthy())
    expect(onApplied).toHaveBeenCalledTimes(1)
    // One matchup left to apply: no "Apply all" for a single one.
    expect(screen.queryByRole('button', { name: /Apply all/ })).toBeNull()
  })

  it('shows nothing for a league the review does not cover', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ covered: false, latest: null }) })))
    const { container } = render(<StatCorrectionsCard leagueId="L" />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
