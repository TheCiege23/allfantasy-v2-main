/**
 * The schedule tools card (components/league-settings/ScheduleToolsCard.tsx, Phase C3): randomize 1–25
 * times with a mid-season confirmation, and set a week by hand with the one-match-per-team rule checked
 * before anything is sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))

import { ScheduleToolsCard } from '@/components/league-settings/ScheduleToolsCard'

const m = (id: string, home: string, away: string) => ({ id, homeRosterId: home, awayRosterId: away, homeName: `T-${home}`, awayName: `T-${away}`, bye: false })
const schedule = {
  playoffStartWeek: 15,
  weeks: [
    { week: 1, locked: true, matchups: [m('x', 'a', 'b'), m('y', 'c', 'd')] },
    { week: 5, locked: false, matchups: [m('1', 'a', 'b'), m('2', 'c', 'd')] },
    { week: 6, locked: false, matchups: [m('3', 'a', 'c'), m('4', 'b', 'd')] },
  ],
}
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const sent = (i: number) => JSON.parse(fetchMock.mock.calls[i]![1].body)

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('randomize', () => {
  it('counts 1 to 25 and sends the chosen number', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule, customWeeks: [] })).mockResolvedValueOnce(reply(200, { posted: 6, regeneratedFromWeek: 5 })).mockResolvedValue(reply(200, { schedule, customWeeks: [] }))
    render(<ScheduleToolsCard leagueId="L1" />)
    const more = await screen.findByRole('button', { name: 'commControl.randomizeMore' })
    fireEvent.click(more)
    expect(screen.getByTestId('schedule-randomize-count').textContent).toBe('6')
    for (let i = 0; i < 30; i++) fireEvent.click(more)
    expect(screen.getByTestId('schedule-randomize-count').textContent).toBe('25')
    expect((more as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 19; i++) fireEvent.click(screen.getByRole('button', { name: 'commControl.randomizeFewer' }))
    fireEvent.click(screen.getByTestId('schedule-randomize-run'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(sent(1)).toEqual({ leagueId: 'L1', action: 'randomize', times: 6 })
    expect((await screen.findByRole('status')).textContent).toBe('commControl.randomizeDone')
  })

  it('mid-season, asks first and retries with the confirmation; a no sends nothing more', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    const mid = { error: 'Weeks that have started stay. Rebuild the rest?', code: 'mid_season_confirmation_required' }
    fetchMock
      .mockResolvedValueOnce(reply(200, { schedule, customWeeks: [] }))
      .mockResolvedValueOnce(reply(409, mid))
      .mockResolvedValueOnce(reply(200, { posted: 5, regeneratedFromWeek: 5 }))
      .mockResolvedValueOnce(reply(200, { schedule, customWeeks: [] }))
      .mockResolvedValueOnce(reply(409, mid))
    render(<ScheduleToolsCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('schedule-randomize-run'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(confirm).toHaveBeenCalledWith(mid.error)
    expect(sent(2)).toEqual({ leagueId: 'L1', action: 'randomize', times: 5, confirmMidSeasonChange: true })
    fireEvent.click(screen.getByTestId('schedule-randomize-run'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(5)
    confirm.mockRestore()
  })
})

describe('custom matchups', () => {
  it('offers only weeks that have not started, marks custom ones, and starts from the week as it stands', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule, customWeeks: [6] }))
    render(<ScheduleToolsCard leagueId="L1" />)
    const select = (await screen.findByTestId('schedule-custom-week-select')) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['commControl.swapWeek 5', 'commControl.swapWeek 6 · commControl.customTag'])
    expect(await screen.findAllByTestId('schedule-custom-pair')).toHaveLength(2)
    expect(screen.queryByTestId('schedule-custom-clear')).toBeNull()
    fireEvent.change(select, { target: { value: '6' } })
    expect(screen.getByTestId('schedule-custom-clear')).toBeTruthy()
  })

  it('blocks a team twice before sending, then saves a valid week', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule, customWeeks: [] })).mockResolvedValueOnce(reply(200, { ok: true })).mockResolvedValue(reply(200, { schedule, customWeeks: [5] }))
    render(<ScheduleToolsCard leagueId="L1" />)
    const [first, second] = await screen.findAllByTestId('schedule-custom-pair')
    const [, firstAway] = within(first!).getAllByRole('combobox')
    fireEvent.change(firstAway!, { target: { value: 'c' } })
    expect(screen.getByTestId('schedule-custom-invalid').textContent).toBe('commControl.customErr.TEAM_TWICE')
    expect((screen.getByTestId('schedule-custom-save') as HTMLButtonElement).disabled).toBe(true)
    const [secondHome] = within(second!).getAllByRole('combobox')
    fireEvent.change(secondHome!, { target: { value: 'b' } })
    expect(screen.queryByTestId('schedule-custom-invalid')).toBeNull()
    fireEvent.click(screen.getByTestId('schedule-custom-save'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(sent(1)).toEqual({ leagueId: 'L1', action: 'set_custom_week', week: 5, pairs: [{ home: 'a', away: 'c' }, { home: 'b', away: 'd' }] })
  })
})
