/**
 * The commissioner chooses the tanking penalty on the integrity page, beside the monitor it governs
 * (owner decision 2026-11-06). League Settings only summarises and links there.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { IntegritySettings, type IntegritySettingsValue } from '@/components/commish/IntegritySettings'
import { IntegritySettingsPanel } from '@/components/commissioner/IntegritySettingsPanel'

const value: IntegritySettingsValue = {
  collusionSensitivity: 'medium',
  tankingMonitorEnabled: true,
  tankingSensitivity: 'medium',
  tankingStartWeek: null,
  tankingIllegalLineupCheck: true,
  tankingBenchPatternCheck: true,
  tankingWaiverPatternCheck: false,
  tankingPenalties: { enabled: true, penalty: 'forfeit_pick', pickAtStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 },
}
afterEach(() => vi.unstubAllGlobals())

describe('tanking penalty choice, on the integrity page', () => {
  it('shows the controls for the chosen penalty and saves the choice with the rest of the settings', () => {
    const onSave = vi.fn()
    render(<IntegritySettings value={value} onSave={onSave} />)
    const kind = screen.getByTestId('tanking-penalty-kind') as HTMLSelectElement
    expect(screen.getByText('Round of the pick')).toBeTruthy()
    expect(screen.queryByTestId('tanking-lottery-cut')).toBeNull()

    fireEvent.change(kind, { target: { value: 'lottery_odds' } })
    fireEvent.change(screen.getByTestId('tanking-lottery-cut'), { target: { value: '100' } })
    expect(screen.queryByText('Round of the pick')).toBeNull()

    fireEvent.change(kind, { target: { value: 'faab' } })
    expect(screen.getByTestId('tanking-faab-percent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /save integrity settings/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0].tankingPenalties).toMatchObject({ penalty: 'faab', lotteryOddsCutPct: 100, faabPercent: 25 })
  })

  it('an imported league, with no penalties to set, shows no penalty controls', () => {
    const { tankingPenalties: _omit, ...imported } = value
    render(<IntegritySettings value={imported} onSave={vi.fn()} />)
    expect(screen.queryByTestId('tanking-penalties')).toBeNull()
  })

  it('a co-commissioner sees the penalties but cannot change them', () => {
    render(<IntegritySettings value={value} onSave={vi.fn()} readOnly />)
    expect((screen.getByTestId('tanking-penalty-kind') as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('League Settings: a summary and a way in, not a second editor', () => {
  it('summarises what is set and links to the integrity page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ settings: { tankingMonitorEnabled: true, tankingPenalties: { enabled: true, penalty: 'faab' } }, stats: { openCollusion: 0, openTanking: 1 } }),
      })),
    )
    render(<IntegritySettingsPanel leagueId="L" hasAccess />)
    expect((await screen.findByText(/confirmed cases lose FAAB/)).textContent).toContain('Tanking monitor: on')
    expect(screen.getByTestId('integrity-settings-link').getAttribute('href')).toBe('/league/L/commissioner/integrity')
    expect(screen.queryByTestId('tanking-penalty-kind')).toBeNull()
  })
})
