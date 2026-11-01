'use client'

import AfCoreShell, { type CoreNavKey } from '@/components/core-app/AfCoreShell'
import { Waivers } from '@/components/core-app/screens/Waivers'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'
import { draftHqFixture, HARNESS_SPORTS, playerFinderFixture, waiversFixture, type HarnessScreen, type HarnessSport } from './fixtures'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. The screens' children fetch on mount (the lineup board, Waiver intel,
 * Chimmy's picks, the orphan auction, taxi stealing, the search box's suggestions…). Installed at MODULE
 * scope — before any effect runs, children's effects included — this answers every same-origin `/api/`
 * call with a 503, so each widget renders its own "could not load" state and nothing reaches a route or
 * a database. Harness-only: app/e2e is 404 in production.
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'harness: no API' }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
      )
    }
    return real(input, init)
  }
}

type Props = { screen: HarnessScreen; sport: string; platform: string; leagueType: string; identityOff: boolean }

/**
 * Harness only (app/e2e is 404 in production): the real AfCoreShell around the real screen, fixture data,
 * for an IMPORTED league — the kind /core actually renders league screens for. The stamp goes through
 * the real decision (`coreShellRedraftSport` → `isImportedRedraftLeague`) on the league's stored
 * settings: a Sleeper `sleeper_league_type: 0` row is redraft, a `2` row with `isDynasty` is not.
 */
export default function RedraftCoreB5HarnessClient(props: Props) {
  const upper = props.sport.toUpperCase()
  const sport: HarnessSport = (HARNESS_SPORTS as readonly string[]).includes(upper) ? (upper as HarnessSport) : 'NFL'
  const dynasty = props.leagueType !== 'redraft'
  const league = { id: 'e2e-redraft-core', name: 'Sunday Night Redraft', platform: props.platform, mark: 'SN', sport }
  const settings = dynasty ? { sleeper_league_type: 2, isDynasty: true } : { sleeper_league_type: 0, best_ball: false }
  const redraftSport = props.identityOff
    ? null
    : coreShellRedraftSport({ platform: props.platform, sport, leagueType: props.leagueType }, props.platform, {
        sport,
        leagueType: props.leagueType,
        settings,
      })
  const active: CoreNavKey = props.screen
  const finder = props.screen === 'players' ? playerFinderFixture(sport, props.platform) : null
  return (
    <AfCoreShell
      active={active}
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      redraftSport={redraftSport}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="redraft-core-b5-fixture" data-screen={props.screen} data-sport-fixture={sport}>
        {props.screen === 'waivers' ? (
          <Waivers data={waiversFixture(sport, props.platform)} edge={null} edgeAccess={null} />
        ) : props.screen === 'draft-hq' ? (
          <DraftHq data={draftHqFixture(sport, props.platform)} edge={null} edgeAccess={null} />
        ) : finder ? (
          <PlayerFinder
            query={finder.query}
            matches={finder.matches}
            detail={finder.detail}
            leagueCount={1}
            selectedLeagueId={league.id}
            nowIso="2026-10-25T16:18:00.000Z"
          />
        ) : null}
      </div>
    </AfCoreShell>
  )
}
