'use client'

import AfCoreShell, { type CoreNavKey } from '@/components/core-app/AfCoreShell'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { YourWeekLeague } from '@/components/core-app/screens/YourWeekLeague'
import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { defenseHubFixture, HARNESS_SPORTS, myTeamFixture, weekBoardFixture, type HarnessScreen, type HarnessSport } from './fixtures'

const NAV: Record<HarnessScreen, CoreNavKey> = { 'my-team': 'my-team', week: 'week', 'defense-hub': 'defense-hub' }

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. The screens' children fetch on mount (team alerts, the week planner,
 * Defense Hub's payload, its trade board, the values link). Installed at MODULE scope — before any effect
 * runs, children's effects included — this answers Defense Hub from the fixture and every other `/api/`
 * call with a 503, so each widget renders its own "could not load" state and nothing reaches a route or a
 * database. Harness-only: app/e2e is 404 in production.
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/idp/players') {
        const view = url.searchParams.get('view')
        if (view === 'defense-hub') return json(defenseHubFixture())
        if (view === 'trade-board') return json({ state: 'no_rostered_defenders', rows: [] })
        return json({ eligible: false })
      }
      return json({ error: 'harness: no API' }, 503)
    }
    return real(input, init)
  }
}

type Props = { screen: HarnessScreen; sport: string; platform: string; leagueType: string; identityOff: boolean }

/** Harness only (app/e2e is 404 in production): the real AfCoreShell around the real screen, fixture data. */
export default function RedraftCoreMyTeamHarnessClient(props: Props) {
  const upper = props.sport.toUpperCase()
  const sport: HarnessSport = (HARNESS_SPORTS as string[]).includes(upper) ? (upper as HarnessSport) : 'NFL'
  const league = { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: props.platform, mark: 'SN', sport }
  const redraftSport = props.identityOff
    ? null
    : coreShellRedraftSport({ platform: props.platform, sport, leagueType: props.leagueType })
  return (
    <AfCoreShell
      active={NAV[props.screen]}
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague
      redraftSport={redraftSport}
      hasIdpDefense={props.screen === 'defense-hub'}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="redraft-core-myteam-fixture" data-screen={props.screen} data-sport-fixture={sport}>
        {props.screen === 'my-team' ? (
          <MyTeam data={myTeamFixture(sport)} />
        ) : props.screen === 'week' ? (
          <YourWeekLeague board={weekBoardFixture(sport)} allWeeksHref="/core/week" lineups={null} />
        ) : (
          <DefenseHubClient leagueId={league.id} embedded />
        )}
      </div>
    </AfCoreShell>
  )
}
