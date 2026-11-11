import { DemoPlayerFinder } from '@/components/demo-league/DemoPlayerFinder'

export default function DemoPlayersPage() {
  return (
    <div className="space-y-4 pt-2">
      <header>
        <h1 className="text-2xl font-black">Player Finder</h1>
        <p className="mt-1 text-sm af-muted">Search real players and see which demo team rosters them.</p>
      </header>
      <DemoPlayerFinder />
    </div>
  )
}
