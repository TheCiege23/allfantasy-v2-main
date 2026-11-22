'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { TradeCenter } from '@/components/core-app/screens/TradeCenter'

/** Two sample leagues; the capture script answers each one's roster read. */
const LEAGUES = [
  { id: 'e2e-eval-dynasty', name: 'Sample Dynasty League', platform: 'sleeper', mark: 'S', meta: 'NFL · 12 teams' },
  { id: 'e2e-eval-redraft', name: 'Sample Redraft League', platform: 'sleeper', mark: 'S', meta: 'NFL · 10 teams' },
]

/**
 * Harness only (app/e2e is 404 in production). The chrome is the real AfCoreShell and the body is the
 * REAL /core Trades hub — TradeCenter with no league, as the /core page renders it — so the league
 * trade evaluator is what a manager sees. Every client read is answered by the capture script.
 */
export default function TradeEvaluatorHarnessClient() {
  const shellLeagues = LEAGUES.map((l) => ({ id: l.id, name: l.name, platform: l.platform, mark: l.mark, sport: 'NFL' }))
  return (
    <AfCoreShell
      active="trades"
      leagues={shellLeagues}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: 'all', label: 'All leagues', favoriteIds: [], leagues: shellLeagues }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="trade-evaluator-fixture">
        <TradeCenter viewerId="e2e-viewer" league={null} leagues={LEAGUES} valueActions={[]} />
      </div>
    </AfCoreShell>
  )
}
