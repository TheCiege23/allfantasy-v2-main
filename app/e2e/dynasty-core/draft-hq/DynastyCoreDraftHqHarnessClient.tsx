'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DraftHq } from '@/components/core-app/screens/DraftHq'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'
import { DYNASTY_DRAFT_HQ_LEAGUE, dynastyDraftHqFixture } from './fixture'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. Children may fetch on mount; installed at MODULE scope — before any
 * effect runs — this answers every same-origin `/api/` call with a 503, so nothing reaches a route or a
 * database. Harness-only: app/e2e is 404 in production.
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

/**
 * Harness only (app/e2e is 404 in production). Chrome and screen are both real — AfCoreShell with
 * `active="draft-hq"` and Draft HQ — fed fixture data (./fixture.ts). `identity=off` renders the shell
 * without the Dynasty Era stamp and Draft HQ without the rookie room, i.e. what a dynasty league's
 * Draft HQ looked like before.
 */
export default function DynastyCoreDraftHqHarnessClient({ identityOff, noDraft }: { identityOff: boolean; noDraft: boolean }) {
  const data = dynastyDraftHqFixture({ identity: !identityOff, noDraft })
  const league = { id: DYNASTY_DRAFT_HQ_LEAGUE.id, name: DYNASTY_DRAFT_HQ_LEAGUE.name, platform: noDraft ? 'sleeper' : 'allfantasy', mark: 'TD', sport: 'NFL' }
  const other = { id: 'e2e-dynasty-core-draft-hq-2', name: 'Sunday Night Redraft', platform: 'sleeper', mark: 'SN', sport: 'NFL' }
  const dynastyEra = !identityOff && coreShellDynasty({ isDynasty: true, leagueType: 'dynasty', format: 'dynasty' })
  return (
    <AfCoreShell
      active="draft-hq"
      leagues={[league, other]}
      selectedLeagueId={league.id}
      nativeLeague={false}
      dynastyEra={dynastyEra}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: league.id, label: league.name, favoriteIds: [], leagues: [league, other] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <DraftHq data={data} edge={null} edgeAccess={null} />
    </AfCoreShell>
  )
}
