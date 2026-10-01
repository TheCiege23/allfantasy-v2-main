import Link from 'next/link'
import { ArrowLeft, Skull } from 'lucide-react'

export const metadata = {
  title: 'Zombie Universe Tracker — AllFantasy',
}

/**
 * Universe tracker for multi-league Zombie tiers (3- and 6-league setups).
 * Data binds to `ZombieUniverse` + linked `ZombieLeague` rows; single-Gamma universes use the league home summary instead.
 */
export default async function ZombieUniverseTrackerPage(props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const { leagueId } = params
  return (
    <div className="min-h-screen bg-[#040915] px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/league/${encodeURIComponent(leagueId)}`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to league
          </Link>
          <span className="rounded-full border border-[#39ff14]/30 bg-[#39ff14]/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#b8ff9a]">
            Beta / Alpha universe
          </span>
        </div>
        <header className="rounded-2xl border border-[#39ff14]/20 bg-gradient-to-br from-[#0c1a10]/95 to-[#0a1228] p-6 shadow-[0_0_60px_rgba(57,255,20,0.07)]">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#39ff14]/15 text-[#b8ff9a]">
              <Skull className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white">Zombie Universe Tracker</h1>
              <p className="mt-1 text-[13px] text-white/50">
                Linked Alpha / Beta / Gamma leagues, whisperer pressure, survivor vs zombie counts, and weekly updates — sport-aware
                cadence from `ZombieWeeklyResolution` + status board snapshots.
              </p>
            </div>
          </div>
        </header>
        <div className="grid gap-4 md:grid-cols-3">
          {['Alpha', 'Beta', 'Gamma'].map((tier) => (
            <div
              key={tier}
              className="rounded-xl border border-white/10 bg-[#0a1228]/80 p-4 backdrop-blur-sm"
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#fbbf24]/90">{tier}</p>
              <p className="mt-2 text-[12px] text-white/45">Standings, whisperer, danger — wire to `/api/zombie/league` + universe aggregates.</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
