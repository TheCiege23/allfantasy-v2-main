/**
 * The commissioner's "fix a problem" tools: each change needs a second tap, then posts the
 * matching action to /api/survivor/commissioner.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SurvivorSeasonFixPanel } from '@/components/survivor/SurvivorSeasonFixPanel'

const managers = [{ userId: 'u1', name: 'Ava' }, { userId: 'u2', name: 'Ben' }]
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse((init as RequestInit).body as string) }))

describe('SurvivorSeasonFixPanel', () => {
  it('corrects a score only after a confirming second tap', async () => {
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={4} merged={false} />)
    fireEvent.click(screen.getByText('Correct a score'))
    fireEvent.change(screen.getByLabelText('Manager to correct'), { target: { value: 'u2' } })
    fireEvent.change(screen.getByLabelText('Points to add or remove'), { target: { value: '-2.5' } })
    fireEvent.click(screen.getByText('Apply correction'))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Confirm: -2.5 for Ben/))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Week 4 score for Ben changed by -2.5'))
    expect(sent()).toEqual([{ url: '/api/survivor/commissioner', body: { leagueId: 'L1', action: 'adjust_score', userId: 'u2', week: 4, adjustmentAmount: -2.5 } }])
  })

  it('keeps the correction disabled until a manager and non-zero points are chosen', () => {
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={4} merged={false} />)
    fireEvent.click(screen.getByText('Correct a score'))
    expect((screen.getByText('Apply correction') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Manager to correct'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Points to add or remove'), { target: { value: '0' } })
    expect((screen.getByText('Apply correction') as HTMLButtonElement).disabled).toBe(true)
  })

  it('removes a manager who quit, with a reason', async () => {
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={4} merged={false} />)
    fireEvent.click(screen.getByText('Remove a manager who quit'))
    fireEvent.change(screen.getByLabelText('Manager to remove'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Reason for removal'), { target: { value: 'Stopped replying' } })
    fireEvent.click(screen.getByText('Remove manager'))
    fireEvent.click(screen.getByText('Confirm: remove Ava'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sent()[0].body).toEqual({ leagueId: 'L1', action: 'remove_player', userId: 'u1', reason: 'Stopped replying' })
  })

  it('offers the early merge only before the merge, and shows the server refusal', async () => {
    const { unmount } = render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={4} merged />)
    expect(screen.queryByText('Start the merge now')).toBeNull()
    unmount()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Finish the open Tribal Council before starting the merge.' }) })
    render(<SurvivorSeasonFixPanel leagueId="L1" managers={managers} week={4} merged={false} />)
    fireEvent.click(screen.getByText('Start the merge now'))
    fireEvent.click(screen.getByText('Start the merge'))
    fireEvent.click(screen.getByText('Confirm: merge now'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Finish the open Tribal Council'))
    expect(sent()[0].body).toEqual(expect.objectContaining({ action: 'force_phase', toPhase: 'merge' }))
  })
})
