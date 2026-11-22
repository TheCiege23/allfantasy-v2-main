import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Inside a league, the rail is the league's (2026-11-15).
 *
 * The "All leagues" (Your week, My Leagues, Rankings, Your career, Devy, Brackets, Find a League) and
 * "Manage" (Notifications, Settings, Plans & tokens, Admin) groups are account-wide, and sat under a
 * league's own tabs as if they were part of it. Inside a league the desktop rail now ends with ONE
 * "All leagues" row, Notifications moves to the top bar with its count, and a "League settings" tab
 * opens the Sleeper-style League Settings hub — a read-only mirror for an imported league.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core/standings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LEAGUE_RAIL_OMITTED_SECTIONS, NAV_SECTION_ORDER, NAV_SECTION_ORDER_NO_LEAGUE } from '@/lib/core-app/leagueDestinations'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { hubText } from '@/lib/league-settings-hub/hubI18n'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups } from '@/lib/league-settings-hub/hubModel'

afterEach(() => cleanup())

const LEAGUES = [{ id: 'l1', name: 'AFC Dreaming!', platform: 'sleeper', mark: 'AD' }]

function shell(selectedLeagueId?: string, notificationCount = 7) {
  return render(
    <AfCoreShell
      active="standings"
      leagues={LEAGUES as never}
      selectedLeagueId={selectedLeagueId}
      notificationCount={notificationCount}
      commissionerCount={1}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
}

const railLabels = (container: HTMLElement) =>
  [...container.querySelectorAll('#af-nav .af-nav-label')].map((e) => e.textContent?.trim())

describe('the destination list', () => {
  it('puts League settings in the league group, after Trades', () => {
    const league = NAV_SECTION_ORDER.find((s) => s.id === 'league')!
    expect(league.keys.at(-1)).toBe('league-settings')
    expect(league.keys.indexOf('league-settings')).toBe(league.keys.indexOf('trades') + 1)
    // League-only: with no league held there is no league to show settings for.
    expect(NAV_SECTION_ORDER_NO_LEAGUE.flatMap((s) => s.keys)).not.toContain('league-settings')
  })

  it('names the two account-wide groups the league rail leaves out, and nothing else', () => {
    expect([...LEAGUE_RAIL_OMITTED_SECTIONS].sort()).toEqual(['all', 'manage'])
  })

  it('has Spanish for the tab, matching the hub’s own name for it', () => {
    expect(coreUiCopy('League settings', 'es')).toBe('Ajustes de la liga')
    expect(hubText('es', 'League settings', 'NFL')).toBe('Ajustes de la liga')
  })
})

describe('the rail inside a league', () => {
  it('drops the All leagues and Manage groups and ends with one All leagues row', () => {
    const { container } = shell('l1')
    const labels = railLabels(container)
    for (const gone of ['My Leagues', 'Rankings', 'Your career', 'Brackets', 'Find a League', 'Notifications', 'Settings', 'Your week']) {
      expect(labels, gone).not.toContain(gone)
    }
    const headings = [...container.querySelectorAll('#af-nav .af-nav-heading')].map((h) => h.textContent?.trim())
    expect(headings).not.toContain('All leagues')
    expect(headings).not.toContain('Manage')
    const exit = container.querySelector('#af-nav .af-nav-all-leagues') as HTMLAnchorElement
    expect(exit).not.toBeNull()
    expect(exit.textContent).toContain('All leagues')
    expect(exit.getAttribute('href')).toBe('/core?view=all&scope=all')
    // It is the rail's LAST row.
    expect(labels.at(-1)).toBe('All leagues')
  })

  it('adds League settings for the open league', () => {
    const { container } = shell('l1')
    const link = [...container.querySelectorAll('#af-nav a')].find((a) => a.textContent?.includes('League settings'))
    expect(link?.getAttribute('href')).toBe('/core/league-settings?league=l1')
  })

  it('moves Notifications to the top bar with its count', () => {
    const { getByTestId } = shell('l1', 7)
    const inbox = getByTestId('topbar-inbox')
    expect(inbox.getAttribute('href')).toBe('/core/notifications?league=l1')
    expect(inbox.textContent).toContain('7')
    expect(inbox.getAttribute('aria-label')).toBe('Notifications, 7')
  })

  it('shows no count when nothing is unread', () => {
    const { getByTestId } = shell('l1', 0)
    expect(getByTestId('topbar-inbox').querySelector('.af-topbar-inbox-badge')).toBeNull()
  })

  it('keeps every account-wide entry in the phone’s More sheet', () => {
    const { getByRole } = shell('l1')
    fireEvent.click(getByRole('button', { name: 'More' }))
    const more = [...document.querySelectorAll('.af-mobile-more-link')].map((a) => a.textContent?.trim() ?? '')
    // And the rail's way out, which a tablet reaches here because its rail is hidden.
    expect([...document.querySelectorAll('.af-mobile-more a')].map((a) => a.getAttribute('href'))).toContain('/core?view=all&scope=all')
    for (const kept of ['Notifications', 'Settings', 'Rankings', 'Find a League']) {
      expect(more.some((t) => t.startsWith(kept)), kept).toBe(true)
    }
  })
})

describe('the rail with no league open is unchanged', () => {
  it('keeps both groups, no exit row and no top-bar inbox', () => {
    const { container, queryByTestId } = shell(undefined)
    const headings = [...container.querySelectorAll('#af-nav .af-nav-heading')].map((h) => h.textContent?.trim())
    expect(headings).toContain('All leagues')
    expect(headings).toContain('Manage')
    expect(container.querySelector('#af-nav .af-nav-all-leagues')).toBeNull()
    expect(queryByTestId('topbar-inbox')).toBeNull()
    expect(railLabels(container)).not.toContain('League settings')
  })
})

describe('My Settings for an imported league is read-only', () => {
  const p = { league: { teamCount: 12, tradeDeadlineWeek: 11, waiverType: 'faab', waiverBudget: 100, playoffTeams: 6 }, settings: { draftType: 'snake', rounds: 15 }, settingsSnapshot: {} }
  const base: HubViewData = {
    leagueId: 'l1', kind: 'redraft', leagueName: 'AFC Dreaming!', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 12, leagueArt: null,
    canEdit: false, isHeadCommissioner: false, importedFrom: 'Sleeper',
    myTeam: { name: 'NewYorkJets!', avatarUrl: null },
    notifications: { groups: buildNotificationGroups('redraft', false), on: {}, leagueEnabled: true },
    general: buildGeneralGroups(p, 'redraft'), waivers: buildWaiverGroups(p, 'redraft'), typeRules: buildTypeRuleGroups(p, 'redraft'),
    commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [],
    members: [], coOwners: null, invite: { link: null, filled: 12, capacity: 12 }, draftHistory: null, seasons: [], standings: [], highScores: [],
    playerHighScores: { seasons: [], rows: [] }, correctionWeeks: { season: 2026, weeks: [] },
  } as unknown as HubViewData
  const cb = {
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(), onLeaveLeague: vi.fn(),
  } as unknown as HubCallbacks

  it('shows the team name as text, says where it changes, and offers no Leave League', () => {
    const { container, getByTestId, queryByText } = render(<LeagueSettingsHubView data={base} cb={cb} initialTab="my" />)
    const team = getByTestId('lsh-team-mirror')
    expect(within(team).getByText('NewYorkJets!')).toBeTruthy()
    expect(within(team).getByText('Change your team name and avatar on Sleeper.')).toBeTruthy()
    expect(container.querySelector('#af-lsh-team-name')).toBeNull()
    expect(queryByText('Change avatar')).toBeNull()
    expect(queryByText('LEAVE LEAGUE')).toBeNull()
    expect(queryByText('Leave League')).toBeNull()
  })

  it('an AllFantasy league keeps the editable name and Leave League', () => {
    const { container, getByText } = render(<LeagueSettingsHubView data={{ ...base, importedFrom: null }} cb={cb} initialTab="my" />)
    expect(container.querySelector('#af-lsh-team-name')).not.toBeNull()
    expect(getByText('LEAVE LEAGUE')).toBeTruthy()
  })

  it('has Spanish for the new line', () => {
    expect(hubText('es', 'Change your team name and avatar on Sleeper.', 'NFL')).toBe('Cambia el nombre y el avatar de tu equipo en Sleeper.')
  })
})

describe('the /core route', () => {
  const page = readFileSync(join(process.cwd(), 'app/core/(shell)/[[...screen]]/page.tsx'), 'utf8')
  it('maps /core/league-settings to the screen and renders the hub for the held league', () => {
    expect(page).toMatch(/'league-settings': 'league-settings',/)
    expect(page).toMatch(/activeKey === 'league-settings'/)
    expect(page).toMatch(/<LeagueSettingsScreen/)
  })
})
