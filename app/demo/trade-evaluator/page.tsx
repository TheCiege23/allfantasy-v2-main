import { getDemoLeagueView, isDemoUnavailable } from '@/lib/demo-league/service'
import { DemoUnavailableCard } from '@/components/demo-league/DemoUnavailable'
import { DemoTradeEvaluator } from '@/components/demo-league/DemoTradeEvaluator'

export const dynamic = 'force-dynamic'

export default async function DemoTradeEvaluatorPage() {
  const view = await getDemoLeagueView()
  if (isDemoUnavailable(view)) return <DemoUnavailableCard />
  // Only names and positions cross to the client — the evaluator needs nothing else.
  const rosters = view.rosters.map((r) => ({
    slot: r.slot,
    players: [...r.starters, ...r.bench].map((p) => ({ name: p.name, position: p.position })),
  }))
  return (
    <div className="space-y-4 pt-2">
      <header>
        <h1 className="text-2xl font-black">Trade Evaluator</h1>
        <p className="mt-1 text-sm af-muted">Build a what-if trade between two demo teams and see who wins on current market value.</p>
      </header>
      <DemoTradeEvaluator teams={view.teams} rosters={rosters} />
    </div>
  )
}
