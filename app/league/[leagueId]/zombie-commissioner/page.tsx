import Link from 'next/link'
import { ArrowLeft, LayoutDashboard } from 'lucide-react'
import { ZombieStatusBoardCard } from '@/app/zombie/components/commissioner/ZombieStatusBoardCard'

export const metadata = {
  title: 'Zombie Commissioner Dashboard — AllFantasy',
}

/** Deep commissioner surface for 3- and 6-league Zombie universes (not shown for single Gamma). */
export default async function ZombieCommissionerDashboardPage(props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const { leagueId } = params
  return (
    <div className="min-h-screen bg-[#040915] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}`}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/80 hover:bg-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to league
        </Link>
        <header className="flex flex-wrap items-start gap-4 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#1a1408]/95 to-[#0a1228] p-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-200">
            <LayoutDashboard className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Zombie Commissioner Dashboard</h1>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-white/55">
              Linked leagues, whisperer controls, items, ambushes, payments, weekly board generation, audit logs, and emergency
              corrections — mirrors tournament-style commissioner depth. Actions persist via `/api/zombie/*` routes and Prisma
              models (`zombie_commissioner_notifications`, `zombie_audit_logs`, etc.).
            </p>
          </div>
        </header>
        <div className="rounded-xl border border-white/10 bg-[#0a1228]/60 p-4 text-[12px] text-white/45">
          Prefer the in-league <span className="text-white/70">Settings → Zombie</span> tabs for production edits; this route is
          the dedicated universe-grade shell for multi-league setups.
        </div>
        <section className="space-y-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-white/55">Weekly status board</h2>
          <ZombieStatusBoardCard leagueId={leagueId} />
        </section>
      </div>
    </div>
  )
}
