'use client'

import { useState } from 'react'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DefenseHubClient } from '@/app/idp/defense-hub/[leagueId]/DefenseHubClient'
import type { HarnessApiRoute } from '../harnessApi'
import { DEFENSE_HUB_API, DEFENSE_HUB_LEAGUE_ID, DEFENSE_HUB_VARIANTS } from './fixtures'

/**
 * Answers the hub's two reads in the browser from ./fixtures.ts (first matching route wins: exact pathname, every
 * `query` entry equal). Every other /api/ call gets a 503, so nothing reaches a route or a database. Installed
 * synchronously during the first render, before the hub's effects fetch.
 */
function installDefenseHubFetch(routes: HarnessApiRoute[]) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __dhHarnessFetch?: boolean }
  if (w.__dhHarnessFetch) return
  w.__dhHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const hit = routes.find((r) => r.path === url.pathname && Object.entries(r.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v))
    return new Response(JSON.stringify(hit ? hit.body : { error: 'harness: no fixture' }), { status: hit ? 200 : 503, headers: { 'Content-Type': 'application/json' } })
  }
}

const LEAGUE = { id: DEFENSE_HUB_LEAGUE_ID, name: 'Blitz Package Dynasty', platform: 'allfantasy', mark: 'BP', sport: 'NFL' }

/**
 * Harness only (app/e2e is 404 in production). `core`: the hub as /core shows it (`/core/defense-hub`), embedded
 * in the real AfCoreShell. `standalone`: the /idp/defense-hub/[leagueId] page, the same client on its own.
 */
export default function DefenseHubHarnessClient({ screen, state }: { screen: 'core' | 'standalone'; state: string }) {
  useState(() => installDefenseHubFetch(DEFENSE_HUB_VARIANTS?.[state] ?? DEFENSE_HUB_API))
  if (screen === 'standalone') return <DefenseHubClient leagueId={DEFENSE_HUB_LEAGUE_ID} />
  return (
    <AfCoreShell
      active="defense-hub"
      leagues={[LEAGUE]}
      selectedLeagueId={LEAGUE.id}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: LEAGUE.id, label: LEAGUE.name, favoriteIds: [], leagues: [LEAGUE] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <DefenseHubClient leagueId={DEFENSE_HUB_LEAGUE_ID} embedded />
    </AfCoreShell>
  )
}
