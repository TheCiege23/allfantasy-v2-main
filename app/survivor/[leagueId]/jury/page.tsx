'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { JuryFinale } from '@/components/survivor/late/JuryFinale'

export default function SurvivorJuryPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const base = `/survivor/${leagueId}`
  const isJury = ctx.playerState === 'jury'

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <header className="survivor-panel rounded-2xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-200">Jury chamber</p>
        <h1 className="mt-2 text-2xl font-black uppercase tracking-wide text-white">Justice · Drama · Payoff</h1>
        <p className="mt-2 text-[13px] text-white/55">The jury decides who wins the season.</p>
      </header>

      {/* Bench, finalist records, sealed ballot and the vote reveal (late-season handoff, JuryFinale). */}
      <section className="mt-8">
        {leagueId ? <JuryFinale leagueId={leagueId} /> : null}
      </section>

      <section className="mt-8 survivor-panel p-4">
        <p className="text-[11px] font-bold uppercase text-white/45">Jury Q&A</p>
        <textarea
          className="mt-2 min-h-[100px] w-full rounded-xl border border-white/10 bg-black/30 p-3 text-[13px] text-white"
          placeholder="Ask a finalist a question or make a statement…"
          disabled={!isJury}
        />
        <p className="mt-2 text-[11px] text-white/35">Submissions route to finale chat when enabled.</p>
      </section>

      <div className="mt-6 text-center">
        <Link href={`${base}/finale`} className="text-[13px] font-semibold text-amber-200">
          Finale stage →
        </Link>
      </div>
    </div>
  )
}
