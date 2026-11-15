/**
 * The swap form (components/league-settings/ScheduleSwapForm.tsx, 2026-11-15): only weeks that can still change, and
 * the server's answer is what the commissioner sees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))

import { ScheduleSwapForm, editableWeeks } from '@/components/league-settings/ScheduleSwapForm'

const m = (id: string, h: string, a: string | null) => ({ id, homeRosterId: h, awayRosterId: a, homeName: `T-${h}`, awayName: a ? `T-${a}` : null, bye: !a })
const state = {
  playoffStartWeek: 7,
  weeks: [
    { week: 5, locked: true, matchups: [m('x', 'A', 'B')] },
    { week: 6, locked: false, matchups: [m('m1', 'A', 'B'), m('m2', 'C', null)] },
    { week: 7, locked: false, matchups: [m('p', 'A', 'C')] },
  ],
}
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('the swap form', () => {
  it('offers only regular-season weeks that have not started', () => {
    expect(editableWeeks(state).map((w) => w.week)).toEqual([6])
  })

  it('sends the swap for the picked week and shows a refusal as it comes back', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule: state })).mockResolvedValueOnce(reply(409, { error: 'Week 6 has already started, so its matchups can no longer change.' }))
    render(<ScheduleSwapForm leagueId="L1" />)
    await screen.findByTestId('schedule-swap-form')
    fireEvent.change(screen.getByLabelText('commControl.swapTeamA'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('commControl.swapTeamB'), { target: { value: 'C' } })
    fireEvent.click(screen.getByTestId('schedule-swap-submit'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ leagueId: 'L1', action: 'swap_teams', week: 6, rosterA: 'B', rosterB: 'C' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/already started/)
  })
})
