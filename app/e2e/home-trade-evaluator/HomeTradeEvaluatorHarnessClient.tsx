'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { HomeTradeEvaluatorCard } from '@/components/core-app/home/HomeTradeEvaluatorCard'

/** The same two sample leagues as /e2e/trade-evaluator; the capture script answers each roster read. */
const LEAGUES = [
  { id: 'e2e-eval-dynasty', name: 'Sample Dynasty League', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'e2e-eval-redraft', name: 'Sample Redraft League', platform: 'sleeper', mark: 'S', meta: 'NFL · 10 teams' },
]

/**
 * Harness only (app/e2e is 404 in production). The real AfCoreShell with the real Home card, folded as
 * Home renders it — for visual review of the card closed and opened. Every client read is answered by
 * the capture script (scripts/trade-evaluator-capture.mjs answers the roster read the same way).
 */
export default function HomeTradeEvaluatorHarnessClient() {
  const shellLeagues = LEAGUES.map((l) => ({ id: l.id, name: l.name, platform: l.platform, mark: l.mark, sport: 'NFL' }))
  return (
    <AfCoreShell
      active="home"
      leagues={shellLeagues}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: 'all', label: 'All leagues', favoriteIds: [], leagues: shellLeagues }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="home-trade-evaluator-fixture">
        <HomeTradeEvaluatorCard leagues={LEAGUES} viewerId="e2e-viewer" />
      </div>
    </AfCoreShell>
  )
}
