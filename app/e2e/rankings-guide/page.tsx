import AfCoreShell from '@/components/core-app/AfCoreShell'
import { Rankings } from '@/components/core-app/screens/Rankings'
import { MoreToolsLinks } from '@/components/core-app/MoreToolsLinks'
import { data } from './sampleData'

/**
 * DB-free render of /core/rankings' Community tab (2026-11-14) inside the real AfCoreShell: the headline
 * that says where you stand, the movement row, the folded filters, the board and the line under it with
 * "How this board is scored". Every figure is SAMPLE data. Production is refused by app/e2e/layout.tsx.
 *
 *   /e2e/rankings-guide               ranked #8 of 9, behind SampleManagerSeven
 *   /e2e/rankings-guide?you=top       ranked #1
 *   /e2e/rankings-guide?you=none      signed in, not on the board
 *   /e2e/rankings-guide?sport=NFL     a filter set: the filter fold opens
 *   /e2e/rankings-guide?scope=portfolio  the My portfolio tab (2026-11-24)
 *   /e2e/rankings-guide?scope=league     the One league tab (2026-11-24)
 *   /e2e/rankings-guide?scope=class      the Class tab (2026-11-24)
 */

export default async function RankingsGuideHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const you = sp.you === 'top' ? 'top' : sp.you === 'none' ? 'none' : 'mid'
  const sport = typeof sp.sport === 'string' ? sp.sport : null
  const scope = sp.scope === 'portfolio' ? 'portfolio' : sp.scope === 'league' ? 'league' : sp.scope === 'class' ? 'class' : 'global'
  return (
    <AfCoreShell
      active="rankings"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="rankings-guide-harness">
        <Rankings data={data(you, sport, scope)} />
        <MoreToolsLinks screen="rankings" language="en" />
      </div>
    </AfCoreShell>
  )
}
