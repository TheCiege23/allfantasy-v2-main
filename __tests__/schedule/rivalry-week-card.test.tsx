/**
 * The rivalry week card (components/league-settings/RivalryWeekCard.tsx, 2026-11-15): preview shows each rival and the
 * facts behind it; apply is offered only after a preview; a refusal is shown as it comes back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))

import { RivalryWeekCard } from '@/components/league-settings/RivalryWeekCard'

const schedule = { playoffStartWeek: 15, weeks: [{ week: 8, locked: false, matchups: [] }] }
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('the rivalry week card', () => {
  it('previews with reasons, then applies the same week', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { schedule }))
      .mockResolvedValueOnce(reply(200, { pairs: [{ homeRosterId: 'a', awayRosterId: 'b', homeName: 'Aces', awayName: 'Bears', rivalry: true, reasons: ['6 H2H MEETINGS'], context: null }] }))
      .mockResolvedValueOnce(reply(200, { pairs: [], applied: true }))
    render(<RivalryWeekCard leagueId="L1" />)
    expect(screen.queryByTestId('rivalry-week-apply')).toBeNull()
    fireEvent.click(await screen.findByTestId('rivalry-week-preview'))
    expect((await screen.findByTestId('rivalry-week-pairs')).textContent).toContain('Aces vs Bears')
    expect(screen.getByText('6 H2H MEETINGS')).toBeTruthy()
    fireEvent.click(screen.getByTestId('rivalry-week-apply'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ leagueId: 'L1', action: 'rivalry_week_apply', week: 8 })
  })

  it('a league with no rivalry history is told so', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule })).mockResolvedValueOnce(reply(409, { error: 'This league has no rivalry history yet.', code: 'NO_RIVALRIES' }))
    render(<RivalryWeekCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('rivalry-week-preview'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/no rivalry history/)
    expect(screen.queryByTestId('rivalry-week-apply')).toBeNull()
  })

  /*
   * A league that plays on another platform has no schedule here to rewrite: it gets the pairings to
   * copy, read-only, and only after the schedule read has answered.
   */
  it('a league with no schedule of its own gets its rival pairings to copy, and no apply', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { schedule: null }))
      .mockResolvedValueOnce(reply(200, { ok: true, platform: 'fantrax', pairs: [{ homeRosterId: '11', awayRosterId: '33', homeName: 'Aces', awayName: 'Cy', rivalry: true, reasons: ['3 meetings'], context: null }] }))
    render(<RivalryWeekCard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('rivalry-week-imported-show'))
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/leagues/L1/rivalry-week')
    expect(screen.getByTestId('rivalry-week-pairs').textContent).toContain('Aces vs Cy')
    expect(screen.getByText('3 meetings')).toBeTruthy()
    expect(screen.getByTestId('rivalry-week-copy')).toBeTruthy()
    expect(screen.queryByTestId('rivalry-week-apply')).toBeNull()
    expect(screen.queryByTestId('rivalry-week-preview')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows nothing when that league has no pairings to give', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { schedule: null })).mockResolvedValueOnce(reply(409, { error: 'none', code: 'NO_RIVALRIES' }))
    const { container } = render(<RivalryWeekCard leagueId="L1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })
})
