'use client'

import AfCoreShell, { type CoreNavKey } from '@/components/core-app/AfCoreShell'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { Waivers } from '@/components/core-app/screens/Waivers'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { waiversFixture } from '../../redraft-core/b5/fixtures'
import { dynastyMyTeamFixture } from '../myteam/fixture'
import { devyMyTeamFixture, finderFixture, playerCardFixture, waiverBoardFixture, type ChipSurface } from './fixture'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. Installed at module scope, before any effect: two same-origin reads are
 * answered with FIXTURE JSON — the player card (`/api/core/player-card`, so a tapped name opens the REAL
 * card through the REAL provider) and the Waivers "Worth adding" board (`/api/idp/players?view=waiver-board`)
 * — and every other `/api/` call gets a 503, so each widget renders its own "could not load" state and
 * nothing reaches a route or a database. Harness-only: app/e2e is 404 in production (app/e2e/layout.tsx).
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      const page = new URLSearchParams(window.location.search)
      const markers = page.get('identity') !== 'off'
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
      if (url.pathname === '/api/core/player-card') return json(playerCardFixture({ markers, prospect: page.get('prospect') === '1' }))
      if (url.pathname === '/api/idp/players' && url.searchParams.get('view') === 'waiver-board') return json(waiverBoardFixture({ markers }))
      return json({ error: 'harness: no API' }, 503)
    }
    return real(input, init)
  }
}

const ACTIVE: Record<ChipSurface, CoreNavKey> = { card: 'my-team', waivers: 'waivers', finder: 'players', devy: 'my-team' }

/**
 * Client half of the dynasty chips harness: the REAL screens inside the REAL AfCoreShell (`dynastyEra`),
 * fixture data, markers from the real builder.
 *
 *   card     My team; tap a name → the player card opens with its age chip + ROOKIE (`&prospect=1` → PROSPECT)
 *   waivers  the Waivers screen; the "Worth adding" board carries age + ROOKIE chips
 *   finder   Player Finder results in a held devy league: age + ROOKIE, PROSPECT on a college match
 *   devy     My team in a C2C league: the devy section's college prospects carry PROSPECT
 *   ?identity=off on any of them → the same screen as it rendered before (no markers, default look)
 */
export default function DynastyChipsHarnessClient({ surface, off }: { surface: ChipSurface; off: boolean }) {
  const league = { id: `e2e-dynasty-chips-${surface}`, name: surface === 'devy' || surface === 'finder' ? 'Campus to Canton' : 'The Deep!', platform: 'sleeper', mark: 'TD', sport: 'NFL' }
  const finder = surface === 'finder' ? finderFixture({ markers: !off }) : null
  return (
    <AfCoreShell
      active={ACTIVE[surface]}
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={!off && coreShellDynasty({ isDynasty: true })}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="dynasty-chips-fixture" data-surface={surface}>
        {surface === 'card' ? (
          <MyTeam data={dynastyMyTeamFixture({ markers: !off })} />
        ) : surface === 'devy' ? (
          <MyTeam data={devyMyTeamFixture({ markers: !off })} />
        ) : surface === 'waivers' ? (
          <Waivers data={{ ...waiversFixture('NFL', 'sleeper'), league: { ...waiversFixture('NFL', 'sleeper').league, id: league.id, name: league.name, format: '12-team NFL dynasty' } }} edge={null} edgeAccess={null} />
        ) : finder ? (
          <PlayerFinder
            query={finder.query}
            matches={finder.matches}
            detail={null}
            leagueCount={1}
            selectedLeagueId={league.id}
            dynastyMarkers={finder.markers}
            nowIso="2026-11-05T16:18:00.000Z"
          />
        ) : null}
      </div>
    </AfCoreShell>
  )
}
