import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAfOptions, buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups, type HubKind, type HubSettingsPayload } from '@/lib/league-settings-hub/hubModel'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { afOptionsSummary } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { resolveLegacySettingsPanel } from '@/lib/league-settings-home/settingsEntryRouting'
import { SUB_PAGE_TITLES } from '@/components/league-settings/home/LeagueSettingsSubPageTitles'
import { checkByePlan, isNaturalByePlan, validByePlans } from '@/lib/playoff-brackets/byePlan'
import { hubText } from '@/lib/league-settings-hub/hubI18n'

/**
 * League Setup › AllFantasy options, and the same rows in the Commissioner Hub (owner's page review
 * #12–16, Phase C2). One model (`buildAfOptions`) feeds both, so they cannot disagree.
 */

afterEach(cleanup)

function payload(league: Record<string, unknown>, snapshot: Record<string, unknown> = {}): HubSettingsPayload {
  return { league: { teamCount: 12, playoffTeams: 6, medianGame: true, ...league }, settingsSnapshot: snapshot }
}
const byKey = (opts: ReturnType<typeof buildAfOptions>) => Object.fromEntries(opts.map((o) => [o.key, o]))

describe('odd number of teams', () => {
  it('an odd redraft or keeper league says what the leftover team plays; the default is the median', () => {
    expect(byKey(buildAfOptions(payload({ teamCount: 11 }), 'redraft', 'L1')).oddTeams).toMatchObject({
      value: 'Plays the league median', description: '11 teams, so one team has no opponent each week.', panel: 'af-options',
    })
    expect(byKey(buildAfOptions(payload({ teamCount: 11, medianGame: false }), 'keeper', 'L1')).oddTeams?.value).toBe('One team rests each week')
    const extra = payload({ teamCount: 11 }, { odd_team_extra_matchup: { enabled: true, opponent: 'median' } })
    expect(byKey(buildAfOptions(extra, 'redraft', 'L1')).oddTeams?.value).toBe('Extra matchup vs last week’s median team')
  })

  it('no row for an even league, or for a type where odd sizes do not turn the median on', () => {
    expect(byKey(buildAfOptions(payload({ teamCount: 12 }), 'redraft', 'L1')).oddTeams).toBeUndefined()
    expect(byKey(buildAfOptions(payload({ teamCount: 11 }), 'dynasty', 'L1')).oddTeams).toBeUndefined()
  })
})

describe('playoff byes', () => {
  it('6 playoff teams: the top two seeds skip round 1 to fill a bracket of 8', () => {
    expect(byKey(buildAfOptions(payload({ playoffTeams: 6 }), 'redraft', 'L1')).byes).toMatchObject({
      value: '#1 waits 1 round · #2 waits 1 round', panel: 'playoffs',
      description: '6 playoff teams: the top seeds skip round 1 to fill a bracket of 8.',
    })
  })

  it('a full bracket has no byes, and a stored custom plan says so', () => {
    expect(byKey(buildAfOptions(payload({ playoffTeams: 8 }), 'redraft', 'L1')).byes?.value).toBe('No byes')
    const custom = validByePlans(6).find((plan) => !isNaturalByePlan(6, plan))!
    expect(checkByePlan(6, custom).ok).toBe(true)
    const row = byKey(buildAfOptions(payload({ playoffTeams: 6 }, { playoff_bye_plan: custom }), 'redraft', 'L1')).byes
    expect(row?.description).toBe('A custom bye plan. The bracket reseeds after each round.')
  })

  it('formats with no playoffs (Survivor, Guillotine) get no byes row', () => {
    expect(byKey(buildAfOptions(payload({}), 'guillotine', 'L1')).byes).toBeUndefined()
    expect(byKey(buildAfOptions(payload({}), 'survivor', 'L1')).byes).toBeUndefined()
  })
})

describe('rookie order, keeper cost, idols', () => {
  it('dynasty, devy and C2C show the rookie order the commissioner chose', () => {
    for (const kind of ['dynasty', 'devy', 'c2c'] as HubKind[]) {
      const row = byKey(buildAfOptions(payload({}, { rookie_draft_order: { mode: 'reverse_max_pf', enabled: true } }), kind, 'L1')).rookieOrder
      expect(row).toMatchObject({ value: 'Reverse max points for', panel: 'draft' })
    }
    expect(byKey(buildAfOptions(payload({}), 'redraft', 'L1')).rookieOrder).toBeUndefined()
    expect(byKey(buildAfOptions(payload({}), 'dynasty', 'L1')).rookieOrder?.value).toBe('Worst to first')
  })

  it('keeper cost reads the cost system, the round shift and the pickup round', () => {
    const k = (l: Record<string, unknown>, snap: Record<string, unknown> = {}) => byKey(buildAfOptions(payload(l, snap), 'keeper', 'L1')).keeperCost
    expect(k({ keeperCostSystem: 'round_based', keeperRoundPenalty: 1 }, { keeper_waiver_cost_round: 10 })).toMatchObject({
      value: '1 round earlier than last season', panel: 'af-options',
      description: 'Set before the draft. A player picked up off waivers costs a round 10 pick.',
    })
    expect(k({ keeperCostSystem: 'inflation', keeperRoundPenalty: 2 })?.value).toBe('2 rounds earlier than last season, growing each year')
    expect(k({ keeperCostSystem: 'round_based', keeperRoundPenalty: 0 })?.value).toBe('Same round as last season')
    expect(k({ keeperCostSystem: 'free' })?.value).toBe('Free: keepers cost no pick')
  })

  it('Survivor idols link to Survivor’s own settings page', () => {
    expect(byKey(buildAfOptions(payload({}), 'survivor', 'L 1')).idols?.href).toBe('/survivor/L%201/settings')
  })

  it('every value and description has Spanish', () => {
    const strings = (['redraft', 'keeper', 'dynasty', 'survivor'] as HubKind[]).flatMap((kind) =>
      buildAfOptions(payload({ teamCount: 11, keeperCostSystem: 'inflation', keeperRoundPenalty: 2 }, { keeper_waiver_cost_round: 9 }), kind, 'L1').flatMap((o) => [o.label, o.description, o.value]),
    )
    expect(strings.length).toBeGreaterThan(10)
    expect(strings.filter((s) => hubText('es', s) === s)).toEqual([])
  })
})

describe('the AllFantasy options sub-page', () => {
  it('is a real settings sub-page, listed only where it holds something', () => {
    expect(resolveLegacySettingsPanel('af-options')).toBe('af-options')
    expect(SUB_PAGE_TITLES['af-options']).toBe('AllFantasy options')
    expect(afOptionsSummary('keeper', 12)).toBe('Keeper rules')
    expect(afOptionsSummary('redraft', 11)).toBe('Odd-team extra matchup')
    expect(afOptionsSummary('keeper', 11)).toBe('Odd-team extra matchup · Keeper rules')
    expect(afOptionsSummary('redraft', 12)).toBeNull()
    expect(afOptionsSummary('dynasty', 11)).toBeNull()
  })
})

function viewData(kind: HubKind, canEdit: boolean): HubViewData {
  const p = payload({ teamCount: 11, playoffTeams: 6, keeperCostSystem: 'round_based', keeperRoundPenalty: 1 })
  return {
    leagueId: 'L1', kind, leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 11, leagueArt: null,
    canEdit, isHeadCommissioner: canEdit, importedFrom: null, myTeam: null,
    notifications: { groups: buildNotificationGroups(kind, canEdit), on: {}, leagueEnabled: true },
    general: buildGeneralGroups(p, kind), waivers: buildWaiverGroups(p, kind), typeRules: buildTypeRuleGroups(p, kind),
    commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [],
    members: [], coOwners: null, invite: null, draftHistory: null, seasons: [], standings: [], highScores: [],
    playerHighScores: null, correctionWeeks: null, commissionerTasks: { cards: [], overflow: [] },
    afOptions: buildAfOptions(p, kind, 'L1'),
  }
}
function cb(): HubCallbacks {
  return {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(),
  }
}

describe('League Setup and the Hub show the same rows', () => {
  it('League Setup: tagged "Also in Hub", each opening its editor', () => {
    const c = cb()
    render(<LeagueSettingsHubView data={viewData('keeper', true)} cb={c} initialTab="setup" />)
    const card = screen.getByTestId('af-options')
    expect(within(card).getAllByText('Also in Hub')).toHaveLength(3)
    expect(within(screen.getByTestId('af-option-keeperCost')).getByText('1 round earlier than last season')).toBeTruthy()
    fireEvent.click(screen.getByTestId('af-option-open-keeperCost'))
    expect(c.onOpenEditor).toHaveBeenCalledWith('af-options')
    fireEvent.click(screen.getByTestId('af-option-open-byes'))
    expect(c.onOpenEditor).toHaveBeenCalledWith('playoffs')
  })

  it('a manager sees the values, without editors', () => {
    render(<LeagueSettingsHubView data={viewData('keeper', false)} cb={cb()} initialTab="setup" />)
    expect(screen.getByTestId('af-option-oddTeams')).toBeTruthy()
    expect(screen.queryByTestId('af-option-open-oddTeams')).toBeNull()
  })

  it('the Hub’s League options show the same rows, and do not list an editor twice', () => {
    render(<LeagueSettingsHubView data={viewData('redraft', true)} cb={cb()} initialTab="hub" />)
    expect(screen.getByTestId('af-option-byes')).toBeTruthy()
    expect(screen.getByTestId('af-option-oddTeams')).toBeTruthy()
    // The byes row opens Playoffs, so the separate Playoffs link is gone.
    expect(screen.queryByTestId('hub-playoffs')).toBeNull()
    expect(screen.getByTestId('hub-league-chimmy')).toBeTruthy()
  })
})
