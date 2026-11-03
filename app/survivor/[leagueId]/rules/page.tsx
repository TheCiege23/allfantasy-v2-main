'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSurvivorRulebook } from '@/lib/survivor/useSurvivorRulebook'

/** This league's rules, built from its current settings every time the page opens. */
export default function SurvivorRulesPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const { sections, failed } = useSurvivorRulebook(leagueId)

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10" data-testid="survivor-rules-page">
      <header className="survivor-panel rounded-2xl p-4">
        <p className="sv-eyebrow">League rules</p>
        <h1 className="sv-h mt-1 text-xl md:text-2xl">How this league plays</h1>
        <p className="mt-1 text-[13px] text-white/60">Always current: these come straight from your commissioner&apos;s settings.</p>
      </header>
      {failed ? <p role="alert" className="mt-4 text-sm text-red-200">The rules could not be loaded. Try again in a moment.</p> : null}
      {!sections && !failed ? <p className="mt-4 text-sm text-white/55">Loading the rules…</p> : null}
      <div className="mt-4 space-y-3">
        {(sections ?? []).map(section => (
          <section key={section.topic} id={section.topic} className="survivor-panel rounded-xl p-4">
            <h2 className="sv-kicker text-[13px]">{section.title}</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-white/70">
              {section.lines.map(line => <li key={line} className="flex gap-2"><span aria-hidden className="text-[var(--survivor-torch)]">•</span><span>{line.replace(/\*\*/g, '')}</span></li>)}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-white/50">
        Still unsure? <Link href={`/survivor/${leagueId}/chimmy`} className="sv-link underline">Ask Chimmy</Link>. Answers are private.
      </p>
    </div>
  )
}
