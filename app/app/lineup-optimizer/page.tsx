import { LineupOptimizerExperience } from '@/components/lineup-optimizer'

export const metadata = {
  title: 'Lineup Optimizer | AllFantasy',
  description: 'Premium lineup decisions, start/sit, and injury-only auto-sub for your fantasy teams.',
}

export default function LineupOptimizerPage() {
  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/80">AllFantasy Tools</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Lineup Optimizer</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/55">
          Real-time decision dashboard: optimal starters, explainable AI, matchup context, and injury-only auto-sub
          — tuned for mobile-first daily engagement.
        </p>
      </header>
      <LineupOptimizerExperience />
    </div>
  )
}
