import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CommissionerWeeklyPlan from '@/components/core-app/CommissionerWeeklyPlan'
import { reviewedPoll, validateWeeklyTask, weeklyTaskSuggestions } from '@/lib/core-app/commissionerWeeklyPlan'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('reviewed commissioner weekly workflow', () => {
  it('requires bounded text, retry identity and an absolute due time', () => {
    const input = { requestId: '0123456789abcdef', title: 'Review lineup', description: 'Check the current evidence', dueAt: '2026-10-09T20:00:00Z' }
    expect(validateWeeklyTask(input)?.dueAt?.toISOString()).toBe('2026-10-09T20:00:00.000Z')
    for (const invalid of [{ ...input, requestId: 'x' }, { ...input, title: ' ' }, { ...input, title: 'x'.repeat(181) }, { ...input, description: 'x'.repeat(4001) }, { ...input, dueAt: '2026-10-09T20:00' }]) expect(validateWeeklyTask(invalid)).toBeNull()
  })
  it('does not offer another league’s issue in a commissioner plan', () => {
    const data = { actions: [{ id: 'a', leagueId: 'A', leagueName: 'A', kind: 'review', count: 0 }, { id: 'b', leagueId: 'B', leagueName: 'B', kind: 'review', count: 0 }] } as WeeklyBlueprint
    expect(weeklyTaskSuggestions(data, 'A').map(s => s.id)).toEqual(['a'])
  })
  it('rejects expired polls and duplicate or empty choices', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(reviewedPoll('Vote?', ['Yes', 'No'], '2026-10-08T12:00:00Z', now)?.options).toEqual(['Yes', 'No'])
    expect(reviewedPoll('Vote?', ['Yes', ' yes '], '2026-10-08T12:00:00Z', now)).toBeNull()
    expect(reviewedPoll('Vote?', ['Yes', ''], '2026-10-08T12:00:00Z', now)).toBeNull()
    expect(reviewedPoll('Vote?', ['Yes', 'No'], '2026-10-06T12:00:00Z', now)).toBeNull()
  })
  it('opens a reviewed announcement in the exact league without publishing', () => {
    const listener = vi.fn(); window.addEventListener(COMMS_OPEN_EVENT, listener)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<CommissionerWeeklyPlan leagueId="A" announcement="Please review the deadline." />)
    fireEvent.click(screen.getByText('Review in league chat'))
    expect(listener.mock.calls[0][0].detail).toMatchObject({ tab: 'league', leagueId: 'A', leagueDraft: { leagueId: 'A', text: 'Please review the deadline.' } })
    expect(fetcher).not.toHaveBeenCalled()
    window.removeEventListener(COMMS_OPEN_EVENT, listener)
  })
  it('keeps the same request identity after an unknown save result', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('Network')).mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetcher)
    render(<CommissionerWeeklyPlan leagueId="A" />)
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Review scoring' } })
    fireEvent.click(screen.getByText('Save task'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be confirmed'))
    fireEvent.click(screen.getByText('Save task'))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Task saved'))
    expect(JSON.parse(fetcher.mock.calls[0][1].body).requestId).toBe(JSON.parse(fetcher.mock.calls[1][1].body).requestId)
    expect(fetcher.mock.calls[0][0]).toContain('league=A')
  })
})
