/**
 * Sleeper-style settings (owner request, 2026-11-28): a setting with choices is one tappable row; its
 * choices open in a sheet, and choosing one saves that one field. A server refusal stays in the sheet.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildGeneralGroups, buildWaiverGroups } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

const payload = {
  league: {
    sport: 'NFL', season: 2026, teamCount: 12, tradeDeadlineWeek: 11, tradeReviewHours: 24, irSlots: 2,
    playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1, waiverType: 'faab', waiverBudget: 100, waiverMinBid: 0,
    waiverHours: 24, waiverClearAfterGames: true, allowPreDraftMoves: true, lockAllMoves: false,
  },
}

function data(canEdit = true): HubViewData {
  return {
    leagueId: 'L', leagueName: 'Test League', kind: 'redraft', sport: 'NFL', season: 2026, teamCount: 12,
    canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    general: buildGeneralGroups(payload, 'redraft'), waivers: buildWaiverGroups(payload, 'redraft'),
  } as unknown as HubViewData
}
function cb(onSetSetting?: HubCallbacks['onSetSetting']): HubCallbacks {
  return {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(), onSaveNote: vi.fn(), onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(),
    onToggleCoCommissioner: vi.fn(), onInviteCoOwner: vi.fn(), onOpenEditor: vi.fn(), onCopy: vi.fn(), onSetSetting,
  } as unknown as HubCallbacks
}

describe('the settings model offers choices', () => {
  it('the trade deadline: None, then every week before the playoffs', () => {
    const row = buildGeneralGroups(payload, 'redraft').flatMap((g) => g.rows).find((r) => r.key === 'deadline')!
    expect(row.edit?.field).toBe('tradeDeadlineWeek')
    expect(row.edit?.current).toBe(11)
    expect(row.edit?.choices[0]).toMatchObject({ value: 0, label: 'None' })
    expect(row.edit?.choices.at(-1)).toMatchObject({ value: 14, label: 'Week 14' })
  })

  it('playoff teams: even fields up to the league size', () => {
    const row = buildGeneralGroups(payload, 'redraft').flatMap((g) => g.rows).find((r) => r.key === 'playoffTeams')!
    expect(row.edit?.choices.map((c) => c.value)).toEqual([2, 4, 6, 8, 10, 12])
  })

  it('keeps a stored value that is not one of the usual choices', () => {
    const row = buildWaiverGroups({ league: { ...payload.league, waiverBudget: 250 } }, 'redraft').flatMap((g) => g.rows).find((r) => r.key === 'budget')!
    expect(row.edit?.choices.map((c) => c.value)).toEqual([50, 100, 200, 250, 300, 500, 1000])
  })

  it('pre-draft moves, lock all moves and clear-after-games are switches now', () => {
    const rows = [...buildGeneralGroups(payload, 'redraft'), ...buildWaiverGroups(payload, 'redraft')].flatMap((g) => g.rows)
    expect(rows.find((r) => r.key === 'preDraft')?.toggle).toEqual({ field: 'allowPreDraftMoves', on: true })
    expect(rows.find((r) => r.key === 'lockAll')?.toggle).toEqual({ field: 'lockAllMoves', on: false })
    expect(rows.find((r) => r.key === 'clearAfter')?.toggle).toEqual({ field: 'waiverClearAfterGames', on: true })
  })
})

describe('the picker', () => {
  it('opens on tap, marks the current value, and saves the one field chosen', async () => {
    const onSet = vi.fn(async () => null)
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    fireEvent.click(screen.getByTestId('setting-row-tradeDeadlineWeek'))
    const sheet = screen.getByRole('dialog', { name: 'Trade Deadline' })
    expect(sheet.querySelector('[aria-checked="true"]')?.textContent).toContain('Week 11')
    fireEvent.click(screen.getByTestId('setting-choice-9'))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('tradeDeadlineWeek', 9))
    await waitFor(() => expect(screen.queryByTestId('setting-picker')).toBeNull())
  })

  it("shows the server's refusal in the sheet and keeps it open", async () => {
    const onSet = vi.fn(async () => 'playoffTeams cannot exceed league size (12)')
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    fireEvent.click(screen.getByTestId('setting-row-playoffTeams'))
    fireEvent.click(screen.getByTestId('setting-choice-8'))
    expect((await screen.findByRole('alert')).textContent).toBe('playoffTeams cannot exceed league size (12)')
    expect(screen.getByTestId('setting-picker')).toBeTruthy()
  })

  it('choosing the current value saves nothing', () => {
    const onSet = vi.fn(async () => null)
    render(<LeagueSettingsHubView data={data()} cb={cb(onSet)} />)
    fireEvent.click(screen.getByTestId('setting-row-irSlots'))
    fireEvent.click(screen.getByTestId('setting-choice-2'))
    expect(onSet).not.toHaveBeenCalled()
    expect(screen.queryByTestId('setting-picker')).toBeNull()
  })

  it('CONTROL: a manager who cannot edit sees plain values, no picker rows', () => {
    render(<LeagueSettingsHubView data={data(false)} cb={cb(vi.fn(async () => null))} />)
    expect(screen.queryByTestId('setting-row-tradeDeadlineWeek')).toBeNull()
    expect(screen.getAllByText('Week 11').length).toBeGreaterThan(0)
  })
})
