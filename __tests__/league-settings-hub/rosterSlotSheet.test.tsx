/**
 * One roster slot's editor (owner request, 2026-11-28): a commissioner taps a slot and sets its count
 * inside the sport's bounds. Mid-season the confirmation is sent only from "Confirm and save".
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildRosterItems } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

const unified = { rosterConfig: { sections: [{ key: 'starters', label: 'Starters', slots: { QB: 1, RB: 2, FLEX: 1 } }, { key: 'bench', label: 'Bench', slots: { BN: 6 } }] } }
const defs = [
  { key: 'QB', label: 'Quarterback', shortLabel: 'QB', minCount: 1, maxCount: 3 },
  { key: 'RB', label: 'Running Back', shortLabel: 'RB', minCount: 0, maxCount: 5 },
  { key: 'FLEX', label: 'Flex', shortLabel: 'FLEX', minCount: 0, maxCount: 4 },
  { key: 'BN', label: 'Bench', shortLabel: 'BN', minCount: 0, maxCount: 15 },
]
function data(canEdit = true): HubViewData {
  return {
    leagueId: 'L', leagueName: 'Test', kind: 'redraft', sport: 'NFL', season: 2026, teamCount: 12, canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    roster: buildRosterItems(unified, defs, 'NFL'),
  } as unknown as HubViewData
}
function cb(onSetRosterSlot?: HubCallbacks['onSetRosterSlot']): HubCallbacks {
  return new Proxy({ onSetRosterSlot } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : vi.fn()) }) as unknown as HubCallbacks
}
const openRoster = () => {
  const fold = document.querySelector('[data-testid="league-settings-fold-roster"]') as HTMLDetailsElement | null
  if (fold) fold.open = true
}

describe('the roster slot editor', () => {
  it('carries each slot key and its bounds', () => {
    const qb = buildRosterItems(unified, defs, 'NFL').find((i) => i.slotKey === 'QB')!
    expect(qb).toMatchObject({ count: 1, min: 1, max: 3 })
  })

  it('steps the count inside the bounds and saves the one slot', async () => {
    const onSet = vi.fn(async () => ({ error: null }))
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    openRoster()
    fireEvent.click(screen.getByTestId('roster-slot-QB'))
    const less = screen.getByRole('button', { name: 'Less' }) as HTMLButtonElement
    expect(less.disabled).toBe(true) // QB's minimum is 1
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByTestId('roster-slot-count').textContent).toBe('3') // capped at 3
    fireEvent.click(screen.getByTestId('roster-slot-save'))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('QB', 3, false))
    await waitFor(() => expect(screen.queryByTestId('roster-slot-editor')).toBeNull())
  })

  it('mid-season: shows the warning and confirms only on the second tap', async () => {
    const onSet = vi.fn()
      .mockResolvedValueOnce({ error: 'The season has started. Confirm to continue.', needsConfirm: true })
      .mockResolvedValueOnce({ error: null })
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    openRoster()
    fireEvent.click(screen.getByTestId('roster-slot-BN'))
    fireEvent.click(screen.getByRole('button', { name: 'Less' }))
    fireEvent.click(screen.getByTestId('roster-slot-save'))
    await screen.findByTestId('roster-slot-confirm')
    expect(onSet).toHaveBeenCalledTimes(1)
    expect(onSet).toHaveBeenLastCalledWith('BN', 5, false)
    fireEvent.click(screen.getByTestId('roster-slot-confirm'))
    await waitFor(() => expect(onSet).toHaveBeenLastCalledWith('BN', 5, true))
  })

  it('shows a refusal and keeps the sheet open', async () => {
    render(<LeagueSettingsHubView data={data()} cb={cb(vi.fn(async () => ({ error: 'Best ball pool too small.' })))} />)
    openRoster()
    fireEvent.click(screen.getByTestId('roster-slot-RB'))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByTestId('roster-slot-save'))
    expect((await screen.findByRole('alert')).textContent).toBe('Best ball pool too small.')
    expect(screen.getByTestId('roster-slot-editor')).toBeTruthy()
  })

  it('CONTROL: a manager who cannot edit sees plain counts', () => {
    render(<LeagueSettingsHubView data={data(false)} cb={cb(vi.fn())} />)
    openRoster()
    expect(screen.queryByTestId('roster-slot-QB')).toBeNull()
  })
})
