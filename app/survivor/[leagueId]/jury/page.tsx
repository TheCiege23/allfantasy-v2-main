'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { JuryFinale } from '@/components/survivor/late/JuryFinale'
import { JuryQaPanel } from '@/components/survivor/late/JuryQaPanel'

const juryPageMessages = defineMessages({
  en: { kicker: 'Jury chamber', title: 'Justice · Drama · Payoff', intro: 'The jury decides who wins the season.', finale: 'Finale stage →' },
  es: { kicker: 'Sala del jurado', title: 'Justicia · Drama · Desenlace', intro: 'El jurado decide quién gana la temporada.', finale: 'Escenario de la final →' },
})

export default function SurvivorJuryPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const base = `/survivor/${leagueId}`
  const m = useMessages(juryPageMessages)

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <header className="survivor-panel rounded-2xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-200">{m.kicker}</p>
        <h1 className="mt-2 text-2xl font-black uppercase tracking-wide text-white">{m.title}</h1>
        <p className="mt-2 text-[13px] text-white/55">{m.intro}</p>
      </header>

      {/* Bench, finalist records, sealed ballot and the vote reveal (late-season handoff, JuryFinale). */}
      <section className="mt-8">
        {leagueId ? <JuryFinale leagueId={leagueId} /> : null}
      </section>

      {/* Jury Q&A, closing speeches and, after the season, who voted for whom. */}
      <section className="mt-8">
        {leagueId ? <JuryQaPanel leagueId={leagueId} /> : null}
      </section>

      <div className="mt-6 text-center">
        <Link href={`${base}/finale`} className="text-[13px] font-semibold text-amber-200">
          {m.finale}
        </Link>
      </div>
    </div>
  )
}
