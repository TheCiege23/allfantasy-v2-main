/**
 * One scoring stat's editor (owner request, 2026-11-28): a commissioner taps a stat, sets its points,
 * and saves that one rule. Mid-season, the server's warning is shown and the confirmation is sent only
 * from the commissioner's own "Confirm and save".
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { groupScoringRules } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

const rules = [
  { statKey: 'pass_td', pointsValue: 4, enabled: true },
  { statKey: 'pass_yd', pointsValue: 0.04, enabled: true },
  { statKey: 'pass_int', pointsValue: -1, enabled: true },
]
function data(canEdit = true): HubViewData {
  return {
    leagueId: 'L', leagueName: 'Test', kind: 'redraft', sport: 'NFL', season: 2026, teamCount: 12, canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    scoring: { preset: 'PPR', categories: groupScoringRules(rules, 'NFL') },
  } as unknown as HubViewData
}
function cb(onSetScoringRule?: HubCallbacks['onSetScoringRule']): HubCallbacks {
  return new Proxy({ onSetScoringRule } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : vi.fn()) }) as unknown as HubCallbacks
}
const openScoring = () => {
  const fold = document.querySelector('[data-testid="league-settings-fold-scoring"]') as HTMLDetailsElement | null
  if (fold) fold.open = true
}

describe('the scoring stat editor', () => {
  it('opens on a stat, steps by half a point, and saves the one rule', async () => {
    const onSet = vi.fn(async () => ({ error: null }))
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    openScoring()
    fireEvent.click(screen.getByTestId('scoring-row-pass_td'))
    expect((screen.getByTestId('scoring-value') as HTMLInputElement).value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect((screen.getByTestId('scoring-value') as HTMLInputElement).value).toBe('5')
    fireEvent.click(screen.getByTestId('scoring-save'))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('pass_td', 5, false))
    await waitFor(() => expect(screen.queryByTestId('scoring-editor')).toBeNull())
  })

  it('a per-yard stat steps by a hundredth and says how many yards make a point', () => {
    render(<LeagueSettingsHubView data={data()} cb={cb(vi.fn(async () => ({ error: null })))} />)
    openScoring()
    fireEvent.click(screen.getByTestId('scoring-row-pass_yd'))
    const sheet = () => within(screen.getByTestId('scoring-editor'))
    expect(sheet().getByText('1 point every 25 yards')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '1 / 20 yd' }))
    expect((screen.getByTestId('scoring-value') as HTMLInputElement).value).toBe('0.05')
    expect(sheet().getByText('1 point every 20 yards')).toBeTruthy()
  })

  it('mid-season: shows the warning, sends nothing extra until the commissioner confirms', async () => {
    const onSet = vi.fn()
      .mockResolvedValueOnce({ error: 'This league’s season has started. Confirm to continue.', needsConfirm: true })
      .mockResolvedValueOnce({ error: null })
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    openScoring()
    fireEvent.click(screen.getByTestId('scoring-row-pass_int'))
    fireEvent.change(screen.getByTestId('scoring-value'), { target: { value: '-2' } })
    fireEvent.click(screen.getByTestId('scoring-save'))
    await screen.findByTestId('scoring-confirm')
    expect(onSet).toHaveBeenCalledTimes(1)
    expect(onSet).toHaveBeenLastCalledWith('pass_int', -2, false)
    fireEvent.click(screen.getByTestId('scoring-confirm'))
    await waitFor(() => expect(onSet).toHaveBeenLastCalledWith('pass_int', -2, true))
    await waitFor(() => expect(screen.queryByTestId('scoring-editor')).toBeNull())
  })

  it('refuses a value that is not a number, and saves nothing when unchanged', () => {
    const onSet = vi.fn(async () => ({ error: null }))
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    openScoring()
    fireEvent.click(screen.getByTestId('scoring-row-pass_td'))
    fireEvent.change(screen.getByTestId('scoring-value'), { target: { value: '' } })
    expect((screen.getByTestId('scoring-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('scoring-value'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('scoring-save'))
    expect(onSet).not.toHaveBeenCalled()
  })

  it('CONTROL: a manager who cannot edit reads the points, with no editor', () => {
    render(<LeagueSettingsHubView data={data(false)} cb={cb(vi.fn())} />)
    openScoring()
    expect(screen.queryByTestId('scoring-row-pass_td')).toBeNull()
  })
})
