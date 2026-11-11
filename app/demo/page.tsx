import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoOverview } from '@/components/demo-league/DemoScreens'

export const dynamic = 'force-dynamic'

export default async function DemoLeaguePage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  return <DemoOverview view={view} />
}
