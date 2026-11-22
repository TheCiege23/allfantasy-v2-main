import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeagueSettingsHubView, rulesEditorFor, seasonsLabel, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
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
    playerHighScores: { seasons: [2026, 2025], rows: [{ rank: 1, name: 'J. Allen', team: 'Blitz Brigade', season: 2025, week: 14, points: '56.58' }] },
    correctionWeeks: { season: 2026, weeks: [{ week: 1, final: true, rescoredAt: '2026-09-12T15:00:00Z' }, { week: 2, final: false, rescoredAt: null }] },
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

  it('Record Book shows player high scores with their window, and steps correction weeks', () => {
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={cb()} initialTab="record" />)
    const highs = screen.getByTestId('league-settings-hub-player-highs')
    expect(within(highs).getByText('J. Allen')).toBeTruthy()
    expect(within(highs).getByText('Blitz Brigade · 2025 Wk 14')).toBeTruthy()
    expect(within(highs).getByText(/2026 & 2025 seasons/)).toBeTruthy()
    const corr = screen.getByTestId('league-settings-hub-corrections')
    // Opens on the latest week, which is still open.
    expect(within(corr).getByText('Week 2')).toBeTruthy()
    expect(within(corr).getByText('OPEN')).toBeTruthy()
    expect(within(corr).getByText('Not rescored')).toBeTruthy()
    expect((within(corr).getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(corr).getByRole('button', { name: 'Previous week' }))
    expect(within(corr).getByText('Week 1')).toBeTruthy()
    expect(within(corr).getByText('FINAL')).toBeTruthy()
    expect(within(corr).queryByText('Not rescored')).toBeNull()
  })

  it('only the head commissioner can flip co-commissioners; the head row shows a tag', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={c} initialTab="members" />)
    expect(screen.getByText('HEAD')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Co-commissioner: Other' }))
    expect(c.onToggleCoCommissioner).toHaveBeenCalledWith('t2', true)
  })
})

describe('native editor routing helpers', () => {
  it('sends each league type to the editor that owns its rules', () => {
    expect(rulesEditorFor('guillotine')).toBe('guillotine-rules')
    expect(rulesEditorFor('pirate')).toBe('pirate-rules')
    expect(rulesEditorFor('survivor')).toBe('survivor-tribes')
    expect(rulesEditorFor('redraft')).toBe('format')
  })

  it('labels the seasons a record list covers', () => {
    expect(seasonsLabel([2026])).toBe('2026')
    expect(seasonsLabel([2026, 2025])).toBe('2026 & 2025')
    expect(seasonsLabel([2026, 2023, 2024])).toBe('2023–2026')
  })
})

describe('Record Book by sport', () => {
  it('a baseball league shows the injured list, a pitching matchup and no football correction days', () => {
    render(<LeagueSettingsHubView data={{ ...makeData('redraft', false), sport: 'MLB' }} cb={cb()} initialTab="record" />)
    expect(screen.getByText('Injured List')).toBeTruthy()
    expect(screen.queryByText('Injured Reserve')).toBeNull()
    expect(screen.getByText('Opponent matchup')).toBeTruthy()
    expect(screen.queryByText('Defense matchup')).toBeNull()
    expect(screen.getAllByText(/pitching staff/).length).toBe(3)
    expect(screen.queryByText(/through Thursday/)).toBeNull()
  })

  it('a football league keeps the football legend', () => {
    render(<LeagueSettingsHubView data={makeData('redraft', false)} cb={cb()} initialTab="record" />)
    expect(screen.getByText('Injured Reserve')).toBeTruthy()
    expect(screen.getByText('Defense matchup')).toBeTruthy()
    expect(screen.getByText(/through Thursday/)).toBeTruthy()
  })

  it('a college basketball league is named in words in the header', () => {
    render(<LeagueSettingsHubView data={{ ...makeData('redraft', false), sport: 'NCAAB' }} cb={cb()} />)
    expect(screen.getAllByText(/College Basketball/).length).toBeGreaterThan(0)
  })
})
