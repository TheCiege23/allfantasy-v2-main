/** The commissioner chooses the tanking penalty on the integrity settings card. */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { IntegritySettingsPanel } from '@/components/commissioner/IntegritySettingsPanel'

const settings = {
  id: 's', leagueId: 'L', collusionSensitivity: 'medium', tankingMonitorEnabled: true, tankingSensitivity: 'medium', tankingStartWeek: null,
  tankingIllegalLineupCheck: true, tankingBenchPatternCheck: true, tankingWaiverPatternCheck: false,
  tankingPenalties: { enabled: true, penalty: 'forfeit_pick', pickAtStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 },
}
afterEach(() => vi.unstubAllGlobals())

describe('tanking penalty choice', () => {
  it('shows the controls for the chosen penalty and saves the choice', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => (init?.method === 'PUT' ? {} : { settings, stats: { openCollusion: 0, openTanking: 0 } }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    render(<IntegritySettingsPanel leagueId="L" hasAccess />)
    const kind = (await screen.findByTestId('tanking-penalty-kind')) as HTMLSelectElement
    expect(screen.getByText('Round of the pick')).toBeTruthy()
    expect(screen.queryByTestId('tanking-lottery-cut')).toBeNull()

    fireEvent.change(kind, { target: { value: 'lottery_odds' } })
    fireEvent.change(screen.getByTestId('tanking-lottery-cut'), { target: { value: '100' } })
    expect(screen.queryByText('Round of the pick')).toBeNull()

    fireEvent.change(kind, { target: { value: 'faab' } })
    expect(screen.getByTestId('tanking-faab-percent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await vi.waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body)).tankingPenalties).toMatchObject({ penalty: 'faab', lotteryOddsCutPct: 100, faabPercent: 25 })
  })
})
