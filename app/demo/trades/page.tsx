import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoTradesScreen } from '@/components/demo-league/DemoScreens'

export const dynamic = 'force-dynamic'

export default async function DemoTradesPage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  return <DemoTradesScreen view={view} />
}
