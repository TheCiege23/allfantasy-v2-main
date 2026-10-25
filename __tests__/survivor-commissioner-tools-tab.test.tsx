/**
 * The Survivor commissioner tab (components/league/CommissionerToolsTab.tsx) used to be a mockup: its
 * paid switches had no handler and its buttons POSTed to a PATCH-only route. These tests fail if a
 * control goes back to not saving.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/league-settings/CommissionerControlPanel', () => ({ CommissionerControlPanel: ({ leagueId }: { leagueId: string }) => <div data-testid="control-panel">{leagueId}</div> }))
vi.mock('@/components/core-app/commissioner/LineupIntegrity', () => ({ LineupIntegrity: ({ leagueId }: { leagueId: string }) => <div data-testid="lineup-integrity">{leagueId}</div> }))

import { CommissionerToolsTab } from '@/components/league/CommissionerToolsTab'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ settings: {} }) }
    return { ok: true, status: 200, json: async () => ({ settings: { tankingMonitorEnabled: false, collusionSensitivity: 'medium' } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const puts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')

describe('Survivor commissioner tools', () => {
  it('uses the working league controls panel and drops the controls that had nothing behind them', () => {
    render(<CommissionerToolsTab leagueId="L1" hasAfCommissionerSub={false} />)
    expect(screen.getByTestId('control-panel').textContent).toBe('L1')
    for (const dead of ['Extended Scoring Corrections', 'Suspicious Trade Alerts', 'Playoff Bracket', 'Force Player to Bench', 'Override Weekly Result']) {
      expect(screen.queryByText(dead)).toBeNull()
    }
  })

  it('without AF Commissioner: the integrity tools are locked with an upgrade link, and nothing is fetched', () => {
    render(<CommissionerToolsTab leagueId="L1" hasAfCommissionerSub={false} />)
    expect(screen.getByTestId('survivor-integrity-locked').querySelector('a')!.getAttribute('href')).toBe('/commissioner-upgrade')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('anti-tanking loads the saved value and a tap saves it', async () => {
    render(<CommissionerToolsTab leagueId="L1" hasAfCommissionerSub />)
    const toggle = screen.getByTestId('survivor-integrity-tanking')
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(puts()).toHaveLength(1))
    const [url, init] = puts()[0]!
    expect(url).toBe('/api/leagues/L1/integrity')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ tankingMonitorEnabled: true })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('collusion sensitivity saves, and a failed save puts the old value back', async () => {
    render(<CommissionerToolsTab leagueId="L1" hasAfCommissionerSub />)
    const select = screen.getByTestId('survivor-integrity-collusion') as HTMLSelectElement
    await waitFor(() => expect(select.disabled).toBe(false))
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 403, json: async () => ({}) }))
    fireEvent.change(select, { target: { value: 'high' } })
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(JSON.parse(String((puts()[0]![1] as RequestInit).body))).toEqual({ collusionSensitivity: 'high' })
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy()
    expect(select.value).toBe('medium')
  })

  it('shows the lineup-neglect report and links to the integrity review page', () => {
    render(<CommissionerToolsTab leagueId="L1" hasAfCommissionerSub />)
    expect(screen.getByTestId('lineup-integrity').textContent).toBe('L1')
    expect(screen.getByTestId('survivor-integrity-review').getAttribute('href')).toBe('/league/L1/commissioner/integrity')
  })
})
