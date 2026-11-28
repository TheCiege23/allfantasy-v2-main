import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LeagueSettingsHubView,
  leagueOptionLinks,
  showsCommissionerHub,
  type HubCallbacks,
  type HubViewData,
} from '@/components/league-settings/hub/LeagueSettingsHubView'
import { commissionerSubView } from '@/components/league-settings/CommissionerControlPanel'
import { hubText } from '@/lib/league-settings-hub/hubI18n'
import { buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups, type HubKind } from '@/lib/league-settings-hub/hubModel'
import type { TaskCard } from '@/lib/core-app/commissioner/tasks'
import { resolveLegacySettingsPanel, settingsPanelView } from '@/lib/league-settings-home/settingsEntryRouting'

/**
 * Settings › Commissioner Hub (owner's page review #16, Phase C1): it replaces "Commissioner tools".
 * A commissioner of an AllFantasy league gets the tab between Members and Record Book: what needs
 * them first, then one card per job, each opening the editor that already does it.
 */

afterEach(cleanup)

const task = (id: string, severity: TaskCard['severity'], title: string): TaskCard => ({
  id, severity, source: 'review', title, detail: `${title} detail`, due: null, action: { label: 'Review', href: `/x/${id}`, external: false },
})

function makeData(kind: HubKind, canEdit: boolean, extra: Partial<HubViewData> = {}): HubViewData {
  const p = {
    league: { teamCount: 12, tradeDeadlineWeek: 11, preventBenchDrops: false, waiverType: 'faab', waiverBudget: 100, playoffTeams: 6 },
    settings: { draftType: 'snake', rounds: 15 },
    settingsSnapshot: {},
  }
  return {
    leagueId: 'L1', kind, leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 12, leagueArt: null,
    canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    myTeam: { name: 'Ghost Protocol', avatarUrl: null },
    notifications: { groups: buildNotificationGroups(kind, canEdit), on: {}, leagueEnabled: true },
    general: buildGeneralGroups(p, kind), waivers: buildWaiverGroups(p, kind), typeRules: buildTypeRuleGroups(p, kind),
    commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [],
    members: [], coOwners: null, invite: null, draftHistory: null, seasons: [], standings: [], highScores: [],
    playerHighScores: null, correctionWeeks: null,
    commissionerTasks: { cards: [task('a', 'bad', 'Trade waiting on your review'), task('b', 'warn', 'Empty starting slot')], overflow: [task('c', 'info', 'Rookie draft not scheduled')] },
    ...extra,
  }
}

function cb(): HubCallbacks {
  return {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(),
  }
}

// The tab's name is its aria-label: it carries a long label and a phone one (2026-11-28).
const tabNames = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))

describe('who gets the Commissioner Hub tab', () => {
  it('a commissioner of an AllFantasy league, between Members and Record Book', () => {
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={cb()} />)
    expect(tabNames()).toEqual(['My Settings', 'League Setup', 'Members', 'Commissioner Hub', 'Record Book'])
  })

  it('not a manager, and not an imported league (its tools live on the host)', () => {
    expect(showsCommissionerHub({ canEdit: false, importedFrom: null })).toBe(false)
    expect(showsCommissionerHub({ canEdit: true, importedFrom: 'Sleeper' })).toBe(false)
    expect(showsCommissionerHub({ canEdit: true, importedFrom: null })).toBe(true)
    render(<LeagueSettingsHubView data={makeData('redraft', false)} cb={cb()} initialTab="hub" />)
    expect(tabNames()).not.toContain('Commissioner Hub')
    // Asked for the hub without being allowed it: League Setup, not a blank panel.
    expect(screen.getByTestId('league-settings-hub-tab-setup').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('league-settings-hub-commissioner')).toBeNull()
  })
})

describe('Needs you', () => {
  it('lists the queue worst first, with each card’s own action, and hides the overflow behind a button', () => {
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={cb()} initialTab="hub" />)
    expect(screen.getByText('Needs you · 3')).toBeTruthy()
    const rows = screen.getAllByTestId('hub-task')
    expect(rows.map((r) => r.querySelector('.af-lsh-task-title')?.textContent)).toEqual(['Trade waiting on your review', 'Empty starting slot'])
    // Each card says how urgent it is in words, not only with a coloured dot.
    expect(rows.map((r) => r.querySelector('.af-lsh-task-tag')?.textContent)).toEqual(['Urgent', 'Soon'])
    expect(within(rows[0]!).getByRole('link', { name: 'Review' }).getAttribute('href')).toBe('/x/a')
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
    expect(screen.getAllByTestId('hub-task')).toHaveLength(3)
  })

  it('says so when nothing needs the commissioner, and when the queue could not be read', () => {
    const { unmount } = render(<LeagueSettingsHubView data={makeData('redraft', true, { commissionerTasks: { cards: [], overflow: [] } })} cb={cb()} initialTab="hub" />)
    expect(screen.getByTestId('hub-tasks-empty').textContent).toBe('Nothing needs you right now.')
    unmount()
    render(<LeagueSettingsHubView data={makeData('redraft', true, { commissionerTasks: null })} cb={cb()} initialTab="hub" />)
    expect(screen.getByText('Could not load what needs you. Try again in a minute.')).toBeTruthy()
  })
})

describe('the cards open the editors that already exist', () => {
  it.each([
    ['hub-edit-lineups', 'commissioner-tools:edit-lineups'],
    ['hub-lock-roster', 'commissioner-tools:lock-roster'],
    ['hub-member-settings', 'commissioner-tools:member-settings'],
    ['hub-co-commissioners', 'commissioner-tools:update-commissioners'],
    ['hub-edit-schedule', 'commissioner-tools:edit-schedule'],
    ['hub-divisions', 'divisions'],
    ['hub-dues', 'dues'],
    ['hub-settings-lock', 'settings-lock'],
    ['hub-league-chimmy', 'ai'],
  ])('%s → %s', (testid, panel) => {
    const c = cb()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={c} initialTab="hub" />)
    fireEvent.click(screen.getByTestId(testid))
    expect(c.onOpenEditor).toHaveBeenCalledWith(panel)
  })

  it('every view a card names is one the commissioner panel can open', () => {
    for (const v of ['edit-lineups', 'lock-roster', 'member-settings', 'update-commissioners', 'edit-schedule']) {
      expect(commissionerSubView(v)).toBe(v)
    }
    // Anything else opens the panel's menu rather than a blank view.
    expect(commissionerSubView('no-such-view')).toBeNull()
    expect(commissionerSubView(null)).toBeNull()
  })

  it('a `<sub-page>:<view>` panel opens the sub-page, and names the view inside it', () => {
    expect(resolveLegacySettingsPanel('commissioner-tools:edit-schedule')).toBe('commissioner-tools')
    expect(settingsPanelView('commissioner-tools:edit-schedule')).toBe('edit-schedule')
    // Plain panels are unchanged.
    expect(resolveLegacySettingsPanel('divisions')).toBe('divisions')
    expect(settingsPanelView('divisions')).toBeNull()
    expect(settingsPanelView(null)).toBeNull()
  })

  it('uses the live Rivalry Week and Storyline panels when the page supplies them', () => {
    render(
      <LeagueSettingsHubView
        data={makeData('redraft', true)}
        cb={cb()}
        initialTab="hub"
        slots={{ rivalryWeek: <div data-testid="live-rivalry" />, storyline: <div data-testid="live-storyline" /> }}
      />,
    )
    expect(screen.getByTestId('live-rivalry')).toBeTruthy()
    expect(screen.getByTestId('live-storyline')).toBeTruthy()
    expect(screen.queryByTestId('hub-rivalry-open')).toBeNull()
  })
})

describe('League options follow the league type', () => {
  const ids = (kind: HubKind) => leagueOptionLinks(kind, 'L 1').map((l) => l.testid)

  it('Survivor: idols, and no playoffs', () => {
    expect(ids('survivor')).toContain('hub-survivor-idols')
    expect(ids('survivor')).not.toContain('hub-playoffs')
    expect(leagueOptionLinks('survivor', 'L 1').find((l) => l.testid === 'hub-survivor-idols')?.href).toBe('/survivor/L%201/settings')
  })

  it('dynasty, devy and c2c name the rookie order; redraft does not', () => {
    for (const k of ['dynasty', 'devy', 'c2c'] as HubKind[]) {
      expect(leagueOptionLinks(k, 'L1').find((l) => l.testid === 'hub-draft')?.label).toBe('Draft and rookie order')
    }
    expect(leagueOptionLinks('redraft', 'L1').find((l) => l.testid === 'hub-draft')?.label).toBe('Draft')
    expect(ids('redraft')).toContain('hub-playoffs')
    expect(ids('guillotine')).not.toContain('hub-playoffs')
  })
})

describe('Spanish', () => {
  it('counts and type names translate through the hub dictionary', () => {
    expect(hubText('es', 'Needs you · 3')).toBe('Te necesita · 3')
    expect(hubText('es', 'Show 2 more')).toBe('Ver 2 más')
    expect(hubText('es', 'Commissioner Hub')).toBe('Centro del comisionado')
  })
})

describe('the hub reads like an app (2026-11-28)', () => {
  it('each tool is one tappable row with an icon and a chevron, not a sentence beside an "Open" pill', () => {
    const onOpenEditor = vi.fn()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={{ ...cb(), onOpenEditor }} initialTab="hub" />)
    const row = screen.getByTestId('hub-edit-lineups')
    expect(row.tagName).toBe('BUTTON')
    expect(row.textContent).toContain('Edit lineups and records')
    expect(row.querySelector('.af-lsh-nav-icon svg')).toBeTruthy()
    expect(row.querySelector('.af-lsh-nav-chevron')).toBeTruthy()
    fireEvent.click(row)
    expect(onOpenEditor).toHaveBeenCalledWith('commissioner-tools:edit-lineups')
  })

  it('folds a long task detail to two lines with Show more', () => {
    const long = 'Open Team 4, Open Team 5, Open Team 6 and 10 more have no manager yet. Invite someone, or let AllFantasy set their projected-best lineup every week; it stops the moment a manager saves a lineup.'
    render(
      <LeagueSettingsHubView
        data={makeData('redraft', true, { commissionerTasks: { cards: [{ id: 'x', title: '13 teams have no manager', detail: long, severity: 'info', action: { label: 'Open', href: '/x' } }], overflow: [] } as never })}
        cb={cb()}
        initialTab="hub"
      />,
    )
    const detail = document.querySelector('.af-lsh-task-detail') as HTMLElement
    expect(detail.getAttribute('data-clamped')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(detail.getAttribute('data-clamped')).toBeNull()
  })
})

describe('league settings on a phone (2026-11-28)', () => {
  it('each tab carries a short phone label, and keeps its full name for readers', () => {
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={cb()} />)
    const hub = screen.getByRole('tab', { name: 'Commissioner Hub' })
    expect(hub.querySelector('.af-lsh-tab-short')?.textContent).toBe('Commish')
    expect(hub.querySelector('.af-lsh-tab-long')?.textContent).toBe('Commissioner Hub')
  })

  it('Advanced settings is the last row of the page, not a button beside the tabs', () => {
    const onOpen = vi.fn()
    render(<LeagueSettingsHubView data={makeData('redraft', true)} cb={cb()} advanced={{ label: 'Advanced settings', onOpen }} />)
    const adv = screen.getByTestId('league-settings-hub-advanced')
    expect(adv.closest('.af-lsh-tabbar')).toBeNull()
    const stack = document.querySelector('.af-lsh-stack')!
    expect(stack.lastElementChild?.contains(adv)).toBe(true)
    fireEvent.click(adv)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
