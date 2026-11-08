'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Dash3ATriageView, type TriageViewDepthAlert, type TriageViewRow } from '@/components/core-app/screens/Dash3ATriageView'
import { LiveMatchupStrip } from '@/components/core-app/screens/LiveMatchupStrip'
import type { RailStanding } from '@/lib/core-app/railMatchups'
import '@/components/core-app/af-dash-triage.css'
// The strip is only ever mounted inside Live scores, which loads this sheet.
import '@/components/core-app/af-live.css'

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. Every same-origin /api/ call gets a 503, so any widget that fetches
 * shows its own "could not load" state and nothing reaches a route or a database. Harness-only.
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response('{"error":"harness: no API"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

const LEAGUE = { id: 'e2e-bestball', name: 'Underdog Best Ball', platform: 'sleeper', mark: 'UB', sport: 'NFL' }

const DEPTH: TriageViewDepthAlert[] = [
  {
    leagueId: LEAGUE.id, leagueName: LEAGUE.name, platform: 'sleeper', href: '/core?league=e2e-bestball',
    waiversHref: '/core/waivers?league=e2e-bestball&pos=WR', position: 'WR', rostered: 6, healthy: 2, out: 3,
    questionable: 1, needed: 3, tone: 'bad',
    flagged: [{ name: 'Parker Okafor', status: 'Out' }, { name: 'Casey Marchetti', status: 'Out' }, { name: 'Rowan Amari', status: 'Out' }, { name: 'Logan Kowalski', status: 'Questionable' }],
  },
  {
    leagueId: 'e2e-bestball-2', leagueName: 'Drafters Tower 14', platform: 'drafters', href: '/core?league=e2e-bestball-2',
    waiversHref: null, position: 'TE', rostered: 3, healthy: 1, out: 0, questionable: 2, needed: 1, tone: 'warn',
    flagged: [{ name: 'Kendall Rourke', status: 'Questionable' }, { name: 'Tyrese Holm', status: 'Doubtful' }],
  },
]

const ROWS: TriageViewRow[] = [
  {
    key: 'okafor', name: 'Parker Okafor', initials: 'PO', sleeperId: null, imageUrl: null, playerHref: '/core/players?q=Parker%20Okafor',
    position: 'WR', team: 'SF', sport: 'NFL', status: 'Out', tone: 'bad', exposure: '2 of 9', exposureCount: 2, exposureTotal: 9,
    startingIn: 0, benchIn: 0, irIn: 0, taxiIn: 0, bestBallIn: 2, value: null, reportedAgo: '2h ago', kickoffMins: 1440,
    description: 'Hamstring. Ruled out Friday.',
    leagues: [
      { id: LEAGUE.id, name: LEAGUE.name, platform: 'sleeper', href: '/core?league=e2e-bestball', slot: null, bench: [] },
      { id: 'e2e-bestball-2', name: 'Drafters Tower 14', platform: 'drafters', href: '/core?league=e2e-bestball-2', slot: null, bench: [] },
    ],
    leagueCount: 2, freeAgentLinks: [],
  },
]

const standing = (provisional: boolean): RailStanding => ({
  rank: 9, outOf: 12, overCut: 14.6, basis: 'best_ball', provisional, placesAboveCut: 2, cutLine: 118.4, elimination: true,
} as RailStanding)

/** Harness only (app/e2e is 404 in production): the real shell, the real components, fixture data. */
export default function BestBallCoreHarnessClient() {
  return (
    <AfCoreShell
      active="home"
      leagues={[LEAGUE]}
      selectedLeagueId={LEAGUE.id}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: LEAGUE.id, label: LEAGUE.name, favoriteIds: [], leagues: [LEAGUE] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="bestball-core-fixture" style={{ display: 'grid', gap: 18 }}>
        <section data-testid="bb-triage">
          <Dash3ATriageView rows={ROWS} overflow={0} valueBasis={null} freshness={<span>Injury news 5m ago</span>} depthAlerts={DEPTH} />
        </section>
        <section data-testid="bb-strip-provisional">
          <LiveMatchupStrip strip={{ kind: 'unavailable', reason: 'no_opponent' }} leagueId={LEAGUE.id} pollMs={3_600_000} standing={standing(true)} />
        </section>
        <section data-testid="bb-strip-final">
          <LiveMatchupStrip strip={{ kind: 'unavailable', reason: 'no_opponent' }} leagueId={LEAGUE.id} pollMs={3_600_000} standing={standing(false)} />
        </section>
      </div>
    </AfCoreShell>
  )
}
