import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DevyHistoryPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/devy/${leagueId}/history`)}`)
  }

  return (
    <div className="min-h-screen bg-[#040915] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0c0c1e]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <Link href={`/league/${leagueId}`} className="text-[12px] font-semibold text-cyan-300/90">
            ← League
          </Link>
          <span className="text-[13px] font-bold">League history</span>
          <span className="w-12" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <section>
          <h2 className="text-[14px] font-bold text-white">Timeline</h2>
          <p className="mt-1 text-[12px] text-white/45">Most recent first — connect to import history when available.</p>
          <div className="mt-4 space-y-4 border-l-2 border-white/[0.08] pl-4">
            {[2025, 2024].map((y) => (
              <div key={y} className="relative rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
                <span className="absolute -left-[21px] top-4 h-3 w-3 rounded-full bg-cyan-500/60" />
                <p className="text-[13px] font-bold text-white">{y} season</p>
                <span className="mt-1 inline-flex rounded-full border border-white/[0.1] px-2 py-0.5 text-[11px] text-white/45">
                  Imported from Sleeper (preview)
                </span>
                <p className="mt-2 text-[12px] text-white/55">🏆 Champion: —</p>
                <p className="mt-1 text-[11px] text-white/40">Standings top 5 · Scoring leader · Confidence: INFERRED</p>
                <button type="button" className="mt-3 text-[11px] font-semibold text-cyan-300/90 underline">
                  View full standings
                </button>
              </div>
            ))}
          </div>
          <p className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/80">
            Seasons before the import cutoff may be missing. Commissioners can add historical data manually.
          </p>
        </section>

        <section>
          <h2 className="text-[14px] font-bold text-white">Titles gallery</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[2024, 2023].map((y) => (
              <div
                key={y}
                className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-violet-900/20 to-black/40 p-4"
              >
                <p className="text-[18px] font-black text-white/90">{y}</p>
                <p className="text-[12px] text-white/55">Team name · Manager</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-[14px] font-bold text-white">Manager records</h2>
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#0a1228] p-4 text-[12px] text-white/60">
            <p>All-time W-L, seasons played, highest single-week score — wiring to league history service.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
