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
})
