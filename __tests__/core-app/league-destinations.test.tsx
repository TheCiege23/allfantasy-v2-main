import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * One list of league destinations (lib/core-app/leagueDestinations.ts), read by the rail, the tablet
 * icon nav, the phone More sheet and the in-league tab row (2026-11-05 navigation cleanup).
 *
 * The tab row's view links are hidden inside the shell, so a view it carried that the shell does
 * not would become unreachable — the reachability test is what stops that.
 */

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { LeagueTabs, OpenLeagueLink } from '@/components/core-app/LeagueTabs'
import CoreLeagueContextBar from '@/components/core-app/CoreLeagueContextBar'
import {
  LEAGUE_DESTINATION_GATES,
  NAV_SECTION_ORDER,
  NAV_SECTION_ORDER_NO_LEAGUE,
  leagueDestinationHidden,
  navSectionFor,
} from '@/lib/core-app/leagueDestinations'

afterEach(cleanup)

const LEAGUES = [{ id: 'l1', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'S' }]

function shell(props: Record<string, unknown> = {}) {
  cleanup()
  const { container } = render(
    <AfCoreShell active="home" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} selectedLeagueId="l1" {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  const rail = container.querySelector('#af-nav') as HTMLElement
  const groups = Array.from(rail.querySelectorAll('.af-nav-group')).map((g) => ({
    heading: g.querySelector('.af-nav-heading')?.textContent ?? null,
    hrefs: Array.from(g.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? ''),
  }))
  return { container, groups, hrefs: groups.flatMap((g) => g.hrefs) }
}

/** The /core path a tab-row key opens; '' is the league's own home. */
const pathOf = (key: string) => (key ? `/core/${key}?league=l1` : '/core?league=l1')

function tabRowKeys(): string[] {
  cleanup()
  const { container } = render(<LeagueTabs leagueId="l1" leagueName="Sunday Night Redraft" activeKey="home" platform="Sleeper" />)
  return Array.from(container.querySelectorAll('.af-lt-views a'))
    .map((a) => a.getAttribute('href') ?? '')
    .map((href) => href.replace(/^\/core\/?/, '').replace(/\?.*$/, ''))
}

describe('the league gates, shared by the rail and the tab row', () => {
  for (const key of ['matchup', 'week', 'standings', 'season-outlook']) {
    it(`hides ${key} only for a league measured to have no scored week`, () => {
      expect(LEAGUE_DESTINATION_GATES[key]).toBe('hasScoredWeek')
      expect(leagueDestinationHidden(key, { hasScoredWeek: false })).toBe(true)
      expect(leagueDestinationHidden(key, { hasScoredWeek: null })).toBe(false)
      expect(leagueDestinationHidden(key, { hasScoredWeek: undefined })).toBe(false)
      expect(leagueDestinationHidden(key, { hasScoredWeek: true })).toBe(false)
    })
  }

  it('hides Trades only where the import measured no trade history', () => {
    expect(leagueDestinationHidden('trades', { trades: false })).toBe(true)
    expect(leagueDestinationHidden('trades', { trades: undefined })).toBe(false)
    expect(leagueDestinationHidden('trades', { trades: true })).toBe(false)
  })

  it('hides Draft HQ only where the import measured no draft', () => {
    expect(leagueDestinationHidden('draft-hq', { draft: false })).toBe(true)
    expect(leagueDestinationHidden('draft-hq', { draft: undefined })).toBe(false)
  })

  it('never hides an ungated view, and hides nothing with no capabilities read', () => {
    for (const key of ['my-team', 'waivers', 'schedule', 'moves', 'players', 'war-room', 'live']) {
      expect(leagueDestinationHidden(key, { hasScoredWeek: false, trades: false, draft: false })).toBe(false)
    }
    expect(leagueDestinationHidden('matchup', null)).toBe(false)
  })
})

describe('the rail, grouped by job', () => {
  it('draws the groups in order: This week · League · Plan ahead · All leagues · Manage', () => {
    const { groups } = shell()
    const headings = groups.map((g) => g.heading).filter(Boolean)
    expect(headings).toEqual(['This week', 'League', 'Plan ahead', 'All leagues', 'Manage'])
  })

  it('puts each league view in its group, carrying the league', () => {
    const { groups } = shell()
    const group = (h: string) => groups.find((g) => g.heading === h)!.hrefs
    expect(group('This week')).toEqual(['/core/my-team?league=l1', '/core/matchup?league=l1', '/core/live?league=l1', '/core/waivers?league=l1'])
    expect(group('League')).toEqual(['/core/standings?league=l1', '/core/schedule?league=l1', '/core/trades?league=l1', '/core/moves?league=l1'])
    expect(group('Plan ahead')).toContain('/core/season-outlook?league=l1')
    expect(group('Plan ahead')).toContain('/core/draft-hq?league=l1')
  })

  it('shows Defense Hub under Plan ahead for an IDP league only', () => {
    expect(shell({ hasIdpDefense: true }).hrefs).toContain('/core/defense-hub?league=l1')
    expect(shell({ hasIdpDefense: false }).hrefs.some((h) => h.startsWith('/core/defense-hub'))).toBe(false)
    expect(navSectionFor('defense-hub')).toBe('plan')
  })

  it('adds a Commish group only for someone who runs a league', () => {
    expect(shell().groups.some((g) => g.heading === 'Commish')).toBe(false)
    expect(shell({ commissionerCount: 2 }).groups.find((g) => g.heading === 'Commish')?.hrefs).toEqual(['/core/commissioner?league=l1'])
  })

  it('applies the shared gates in the rail too — Draft HQ included', () => {
    const { hrefs } = shell({ leagueHasScoredWeek: false, importCapabilities: { trades: false, draft: false } })
    for (const key of ['matchup', 'standings', 'season-outlook', 'trades', 'draft-hq']) {
      expect(hrefs.some((h) => h.startsWith(`/core/${key}`))).toBe(false)
    }
    expect(hrefs).toContain('/core/schedule?league=l1')
  })

  it('offers Schedule and Moves only with a league held', () => {
    const { hrefs } = shell({ selectedLeagueId: null })
    expect(hrefs.some((h) => h.startsWith('/core/schedule') || h.startsWith('/core/moves'))).toBe(false)
  })

  /* 2026-11-12: each no-league board repeated Your week or Season Outlook, so these need a league. */
  it('offers My team, Waivers, Matchup, Standings and War Room only with a league held', () => {
    const { hrefs } = shell({ selectedLeagueId: null })
    for (const key of ['my-team', 'waivers', 'matchup', 'standings', 'war-room']) {
      expect(hrefs.some((h) => h.startsWith(`/core/${key}`))).toBe(false)
    }
    expect(hrefs).toContain('/core/week')
    expect(hrefs).toContain('/core/season-outlook')
    // ...and every one of them is back once a league is held.
    const held = shell().hrefs
    for (const key of ['my-team', 'waivers', 'matchup', 'standings', 'war-room']) {
      expect(held).toContain(`/core/${key}?league=l1`)
    }
  })

  it('regroups the rail with no league: Your week leads This week, and there is no League group', () => {
    const { groups } = shell({ selectedLeagueId: null })
    expect(groups.map((g) => g.heading).filter(Boolean)).toEqual(['This week', 'Plan ahead', 'All leagues', 'Manage'])
    const group = (h: string) => groups.find((g) => g.heading === h)!.hrefs
    expect(group('This week')).toEqual(['/core/week', '/core/live', '/core/trades'])
    expect(group('Plan ahead')).toEqual(['/core/season-outlook', '/core/players', '/core/draft-hq'])
  })

  it('every key named in a no-league rail group renders with no league, and none lands in a trailing group', () => {
    const { groups } = shell({ selectedLeagueId: null, commissionerCount: 1, isAdmin: true })
    const rendered = new Set(groups.flatMap((g) => g.hrefs).map((h) => h.replace(/^\/core\/?/, '').replace(/\?.*$/, '')))
    const conditional = new Set(['devy', 'brackets', 'find-league', 'my-leagues', 'settings', 'plans', 'admin', 'home'])
    for (const section of NAV_SECTION_ORDER_NO_LEAGUE) {
      for (const key of section.keys) if (!conditional.has(key)) expect(rendered.has(key)).toBe(true)
    }
    // A trailing unheaded group after Manage means some key was placed in neither list.
    expect(groups[groups.length - 1]!.heading).not.toBeNull()
  })
})

describe('nothing the tab row carried became unreachable', () => {
  it('every tab-row view is a rail link — and so a tablet and phone More sheet link too', () => {
    const keys = tabRowKeys()
    expect(keys.length).toBeGreaterThan(10)
    const { hrefs } = shell()
    for (const key of keys) {
      // The tab row's Overview is the league's home; the rail's Home carries the league the same way.
      expect(hrefs).toContain(pathOf(key))
    }
  })

  it('every key named in a rail group is one the shell actually renders somewhere', () => {
    const { hrefs } = shell({ hasIdpDefense: true, commissionerCount: 1, isAdmin: true })
    const rendered = new Set(hrefs.map((h) => h.replace(/^\/core\/?/, '').replace(/\?.*$/, '')))
    const conditional = new Set(['devy', 'devy-league', 'brackets', 'find-league', 'my-leagues', 'settings', 'plans', 'admin', 'home'])
    for (const section of NAV_SECTION_ORDER) {
      for (const key of section.keys) if (!conditional.has(key)) expect(rendered.has(key)).toBe(true)
    }
  })
})

describe('Open League moves into the context bar when the bar is drawn', () => {
  it('the tab row omits its own pill when told the bar carries it, and keeps it otherwise', () => {
    cleanup()
    const own = render(<LeagueTabs leagueId="l1" leagueName="L" activeKey="my-team" platform="Sleeper" />)
    expect(own.container.querySelectorAll('.af-lt-workspace-open')).toHaveLength(1)
    cleanup()
    const elsewhere = render(<LeagueTabs leagueId="l1" leagueName="L" activeKey="my-team" platform="Sleeper" workspaceLinkElsewhere />)
    expect(elsewhere.container.querySelectorAll('.af-lt-workspace-open')).toHaveLength(0)
  })

  it('the context bar draws the link it is handed, to the league workspace', () => {
    cleanup()
    const { container } = render(
      <CoreLeagueContextBar
        leagueId="l1"
        leagueName="Its gonna be Maye 26"
        platform="sleeper"
        syncLabel="just now"
        syncStale={false}
        gameDayActive={false}
        surface={'my-team' as never}
        workspaceLink={<OpenLeagueLink leagueId="l1" platform="Sleeper" />}
      />,
    )
    const link = container.querySelector('.af-lctx .af-lt-workspace-open')
    expect(link?.getAttribute('href')).toBe('/league/l1')
  })
})
