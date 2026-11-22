'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { dynastyMyTeamFixture } from './fixture'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. My Team's children fetch on mount (alerts, highlights, clips); every
 * `/api/` call is answered 503 here so each widget renders its own "could not load" state and nothing
 * reaches a route or a database. Harness-only: app/e2e is 404 in production (app/e2e/layout.tsx).
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'harness: no API' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

/**
 * Client half of the DB-free render of /core My team for a dynasty league — the REAL MyTeam inside the REAL AfCoreShell,
 * with roster markers built by the real builder from fixture rows. Visual review only.
 *
 *   /e2e/dynasty-core/myteam                 ← markers, gold identity
 *   /e2e/dynasty-core/myteam?identity=off    ← the same roster as a dynasty league rendered before
 */
export default function DynastyCoreMyTeamHarnessClient({ off }: { off: boolean }) {
  const data = dynastyMyTeamFixture({ markers: !off })
  const league = { id: data.league.id, name: data.league.name, platform: 'sleeper', mark: 'TD', sport: 'NFL' }
  return (
    <AfCoreShell
      active="my-team"
      leagues={[league]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={!off && coreShellDynasty({ isDynasty: true })}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <MyTeam data={data} />
    </AfCoreShell>
  )
}
