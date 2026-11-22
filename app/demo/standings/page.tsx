import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { Standings } from '@/components/core-app/screens/Standings'
import { DEMO_CORE_LEAGUE_ID } from '@/lib/demo-league/coreHome'
import { demoLeagueStandings } from '@/lib/demo-league/coreStandings'

export const dynamic = 'force-dynamic'

/** The app's own Standings screen, on the anonymized demo view (lib/demo-league/coreStandings.ts). */
export default async function DemoStandingsPage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  return <Standings data={demoLeagueStandings(view, { id: DEMO_CORE_LEAGUE_ID, name: view.leagueName })} />
}
