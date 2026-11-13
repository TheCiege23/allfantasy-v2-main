import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups, type HubKind } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

function makeData(kind: HubKind, canEdit: boolean): HubViewData {
  const p = {
    league: { teamCount: 12, tradeDeadlineWeek: 11, preventBenchDrops: false, waiverType: 'faab', waiverBudget: 100, customDailyWaivers: true, waiverSchedule: { mon: 'waivers' }, playoffTeams: 6 },
    settings: { draftType: 'snake', rounds: 15, autostart: true, cpuAutoPick: true },
    settingsSnapshot: {},
  }
  const groups = buildNotificationGroups(kind, canEdit)
  return {
    leagueId: 'L1', kind, leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 12, leagueArt: null,
    canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    myTeam: { name: 'Ghost Protocol', avatarUrl: null },
    notifications: { groups, on: { trade_proposals: false }, leagueEnabled: true },
    general: buildGeneralGroups(p, kind), waivers: buildWaiverGroups(p, kind), typeRules: buildTypeRuleGroups(p, kind),
    commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [],
    members: [
      { id: 't1', name: 'Head', teamName: 'A', avatarUrl: null, isCommissioner: true, isCoCommissioner: false, isYou: true },
      { id: 't2', name: 'Other', teamName: 'B', avatarUrl: null, isCommissioner: false, isCoCommissioner: false, isYou: false },
    ],
    coOwners: null, invite: { link: null, filled: 12, capacity: 12 }, draftHistory: null, seasons: [], standings: [], highScores: [],
  }
}

function cb(): HubCallbacks {
  return {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(),
  }
}

describe('LeagueSettingsHubView', () => {
  it('saves a commissioner toggle through onToggleSetting with the next value', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={c} />)
    fireEvent.click(screen.getByRole('switch', { name: /Prevent Bench Players/ }))
    expect(c.onToggleSetting).toHaveBeenCalledWith('preventBenchDrops', true)
  })

  it('locks every league switch for a manager and says why', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', false)} cb={c} />)
    expect(screen.getByText('Only commissioners can change league settings')).toBeTruthy()
    const sw = screen.getByRole('switch', { name: /Prevent Bench Players/ })
    expect((sw as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(sw)
    expect(c.onToggleSetting).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('switches tabs and shows per-league notification state', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={c} />)
    fireEvent.click(screen.getByRole('tab', { name: 'My Settings' }))
    const trade = screen.getByRole('switch', { name: 'Trade Proposals' })
    expect(trade.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(trade)
    expect(c.onToggleNotification).toHaveBeenCalledWith('trade_proposals', true)
  })

  it('titles format rules and endgame by league type', () => {
    render(<LeagueSettingsHubView data={makeData('guillotine', true)} cb={cb()} />)
    const jump = screen.getByRole('navigation', { name: 'On this page' })
    expect(within(jump).getByText('Waivers')).toBeTruthy()
    expect(screen.getByText('Endgame')).toBeTruthy()
    expect(screen.getByText('Chopped Rosters')).toBeTruthy()
    expect(screen.queryByText('Playoff Teams')).toBeNull()
  })

  it('only the head commissioner can flip co-commissioners; the head row shows a tag', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={c} initialTab="members" />)
    expect(screen.getByText('HEAD')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Co-commissioner: Other' }))
    expect(c.onToggleCoCommissioner).toHaveBeenCalledWith('t2', true)
  })
})
