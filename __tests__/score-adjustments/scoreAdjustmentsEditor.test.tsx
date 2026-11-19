import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ScoreAdjustmentsEditor } from '@/components/league-settings/home/ScoreAdjustmentsEditor'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const week = (over: Record<string, unknown> = {}) => ({
  week: 4, weeks: [3, 4], scoringMode: 'points',
  matchups: [{ matchupId: 'm1', status: 'final', teams: [{ rosterId: 'h', name: 'Hawks', score: 101.5, adjustment: 0 }, { rosterId: 'a', name: 'Owls', score: 85, adjustment: -5 }] }],
  adjustments: [{ id: 'adj1', matchupId: 'm1', rosterId: 'a', week: 4, points: -5, reason: 'empty slot', byUserId: 'u', at: 'now' }],
  ...over,
})

function stub(view = week()) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === 'POST' ? { status: 'ok' } : view) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('score adjustments editor', () => {
  it('shows each team’s score and its adjustment, and saves a new one with points and a reason', async () => {
    const fetchMock = stub()
    render(<ScoreAdjustmentsEditor leagueId="L" />)
    await screen.findByText('Hawks')
    expect(screen.getByLabelText('includes −5 adjustment')).toBeTruthy()
    expect(screen.getByText(/empty slot/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Adjust' })[0])
    const save = screen.getByRole('button', { name: 'Save adjustment' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText(/^Points/), { target: { value: '2.5' } })
    expect(save.disabled).toBe(true) // no reason yet
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'stat correction' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true))
    const body = JSON.parse(String((fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')![1] as RequestInit).body))
    expect(body).toEqual({ action: 'score_adjustment_add', matchupId: 'm1', rosterId: 'h', points: 2.5, reason: 'stat correction' })
    await screen.findByText('Saved: Hawks +2.5.')
  })

  it('removes an adjustment by id', async () => {
    const fetchMock = stub()
    render(<ScoreAdjustmentsEditor leagueId="L" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String((c[1] as RequestInit | undefined)?.body ?? '').includes('score_adjustment_remove'))).toBe(true))
    const call = fetchMock.mock.calls.find((c) => String((c[1] as RequestInit | undefined)?.body ?? '').includes('remove'))!
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ action: 'score_adjustment_remove', adjustmentId: 'adj1' })
  })

  it('marks an unfinished game final with a reason, and offers to reopen one closed by hand', async () => {
    const open = { matchupId: 'm1', status: 'active', manualFinal: null, teams: [{ rosterId: 'h', name: 'Hawks', score: 101.5, adjustment: 0 }, { rosterId: 'a', name: 'Owls', score: 85, adjustment: 0 }] }
    const closed = { ...open, matchupId: 'm2', status: 'final', manualFinal: { reason: 'no stat feed' } }
    const fetchMock = stub(week({ matchups: [open, closed], adjustments: [] }))
    render(<ScoreAdjustmentsEditor leagueId="L" />)
    // One game still open: one "Mark final". The closed one shows its reason and "Reopen game".
    const mark = await screen.findByTestId('score-adj-mark-final')
    expect(screen.getAllByTestId('score-adj-mark-final')).toHaveLength(1)
    expect(screen.getByTestId('score-adj-manual-final').textContent).toContain('no stat feed')
    fireEvent.click(mark)
    const confirm = within(screen.getByTestId('score-final-form')).getByRole('button', { name: 'Mark final' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // no reason yet
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'game called off' } })
    fireEvent.click(confirm)
    const posted = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST').map((c) => JSON.parse(String((c[1] as RequestInit).body)))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({ action: 'matchup_finalize', matchupId: 'm1', reason: 'game called off' })
    await screen.findByText('Marked final: Hawks vs Owls.')
    fireEvent.click(screen.getByTestId('score-adj-reopen'))
    await waitFor(() => expect(posted()).toHaveLength(2))
    expect(posted()[1]).toEqual({ action: 'matchup_reopen', matchupId: 'm2' })
  })

  it('explains why a category league has no adjustments', async () => {
    stub(week({ scoringMode: 'h2h_category' }))
    render(<ScoreAdjustmentsEditor leagueId="L" />)
    expect(await screen.findByText(/Score adjustments are for points leagues/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull()
  })
})
