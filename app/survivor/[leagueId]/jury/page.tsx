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
        <p className="sv-eyebrow">Jury chamber</p>
        <h1 className="sv-h mt-2 text-2xl uppercase md:text-3xl">Justice · Drama · Payoff</h1>
        <p className="mt-2 text-[13px] text-white/55">The jury decides who wins the season.</p>
      </header>

      {/* Bench, finalist records, sealed ballot and the vote reveal (late-season handoff, JuryFinale). */}
      <section className="mt-8">
        {leagueId ? <JuryFinale leagueId={leagueId} /> : null}
      </section>

      <section className="mt-8 survivor-panel rounded-2xl p-4">
        <p className="sv-kicker text-[11px]">Jury Q&A</p>
        <textarea
          className="mt-2 min-h-[100px] w-full rounded-xl border border-white/10 bg-black/30 p-3 text-[13px] text-white placeholder:text-white/40 focus:border-[rgba(240,163,94,0.55)] focus:outline-none"
          placeholder="Ask a finalist a question or make a statement…"
          disabled={!isJury}
        />
        <p className="mt-2 text-[11px] text-white/35">Submissions route to finale chat when enabled.</p>
      </section>

      <div className="mt-6 text-center">
        <Link href={`${base}/finale`} className="sv-link text-[13px]">
          Finale stage →
        </Link>
      </div>
    </div>
  )
}
