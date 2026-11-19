import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoLeagueExtras } from '@/components/demo-league/DemoScreens'
import { LeagueHome } from '@/components/core-app/screens/LeagueHome'
import { DEMO_HIDDEN_HOME_SECTIONS, demoLeagueHome } from '@/lib/demo-league/coreHome'

export const dynamic = 'force-dynamic'

/** The app's own league Home, fed the anonymized demo view (lib/demo-league/coreHome.ts), then the
 *  demo's teams, League Health, alerts and trades, which the real Home has no panel for. */
export default async function DemoLeaguePage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  return (
    <>
      <LeagueHome data={demoLeagueHome(view)} hiddenSections={[...DEMO_HIDDEN_HOME_SECTIONS]} otherLeagueIssueCount={0} identityInShell />
      <DemoLeagueExtras view={view} />
    </>
  )
}
