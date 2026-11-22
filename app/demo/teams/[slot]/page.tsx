import { notFound } from 'next/navigation'
import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoTeamScreen } from '@/components/demo-league/DemoScreens'

export const dynamic = 'force-dynamic'

export default async function DemoTeamPage(props: { params: Promise<{ slot: string }> }) {
  const { slot: raw } = await props.params
  const slot = Number(raw)
  if (!Number.isInteger(slot) || slot < 1) notFound()
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  const team = view.teams.find((t) => t.slot === slot)
  if (!team) notFound()
  return <DemoTeamScreen view={view} team={team} />
}
