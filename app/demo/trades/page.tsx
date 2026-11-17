import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoTradesScreen } from '@/components/demo-league/DemoScreens'

export const dynamic = 'force-dynamic'

/*
 * ⚠ NOT THE APP'S Trades SCREEN, ON PURPOSE. That screen is written from the viewer's side of each
 * trade ("Received ⇄ Sent", "partner not identified") and its deadline and grade panels need data the
 * demo does not publish; with no "you" every row read as broken. The demo's own list — inside the
 * app's frame — names both sides plainly. Tried and measured 2026-11-15.
 */
export default async function DemoTradesPage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  return <DemoTradesScreen view={view} />
}
