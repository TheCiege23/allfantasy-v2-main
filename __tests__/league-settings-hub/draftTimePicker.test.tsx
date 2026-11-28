/**
 * Draft Time as a picker (owner request, 2026-11-28): set in the LEAGUE'S time zone, saved as the UTC
 * instant it names; a past or impossible time is refused before anything is sent; it can be cleared.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups } from '@/lib/league-settings-hub/hubModel'

afterEach(() => { cleanup(); vi.useRealTimers() })

const payload = (draftDateUtc: string | null) => ({ league: { timezone: 'America/New_York' }, settings: { draftType: 'snake', draftDateUtc } })
function renderHub(draftDateUtc: string | null, onSetSetting = vi.fn(async () => null), draftStarted = false) {
  const data = { leagueId: 'L', leagueName: 'T', kind: 'redraft', sport: 'NBA', season: 2026, teamCount: 16, canEdit: true, isHeadCommissioner: true, importedFrom: null, draft: buildDraftGroups(payload(draftDateUtc), { draftStarted }) } as unknown as HubViewData
  const cb = new Proxy({ onSetSetting } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : vi.fn()) }) as unknown as HubCallbacks
  render(<LeagueSettingsHubView data={data} cb={cb} />)
  const fold = document.querySelector('[data-testid="league-settings-fold-draft"]') as HTMLDetailsElement | null
  if (fold) fold.open = true
  return onSetSetting
}

describe('the draft time picker', () => {
  it('opens on the saved time in league time, and saves the UTC instant the league wall clock names', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-28T12:00:00Z'), shouldAdvanceTime: true })
    const onSet = renderHub('2026-12-05T01:00:00.000Z') // 8:00 PM EST on Dec 4
    fireEvent.click(screen.getByTestId('setting-row-draftDateUtc'))
    expect((screen.getByTestId('datetime-date') as HTMLInputElement).value).toBe('2026-12-04')
    expect((screen.getByTestId('datetime-time') as HTMLInputElement).value).toBe('20:00')
    expect(screen.getByText(/League time \(EST\)/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('datetime-time'), { target: { value: '21:30' } })
    fireEvent.click(screen.getByTestId('datetime-save'))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('draftDateUtc', '2026-12-05T02:30:00.000Z'))
  })

  it('refuses a time in the past, and sends nothing', () => {
    vi.useFakeTimers({ now: new Date('2026-11-28T12:00:00Z'), shouldAdvanceTime: true })
    const onSet = renderHub(null)
    fireEvent.click(screen.getByTestId('setting-row-draftDateUtc'))
    fireEvent.change(screen.getByTestId('datetime-date'), { target: { value: '2026-11-01' } })
    expect(screen.getByRole('alert').textContent).toBe('Choose a time in the future.')
    expect((screen.getByTestId('datetime-save') as HTMLButtonElement).disabled).toBe(true)
    expect(onSet).not.toHaveBeenCalled()
  })

  it('clears a saved time with null', async () => {
    const onSet = renderHub('2027-01-05T01:00:00.000Z')
    fireEvent.click(screen.getByTestId('setting-row-draftDateUtc'))
    fireEvent.click(screen.getByTestId('datetime-clear'))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('draftDateUtc', null))
  })

  it('CONTROL: once the draft has started there is no picker', () => {
    renderHub('2026-11-01T01:00:00.000Z', vi.fn(), true)
    expect(screen.queryByTestId('setting-row-draftDateUtc')).toBeNull()
  })
})
