'use client'

import Link from 'next/link'
import type { SurvivorStatusCard as Card, SurvivorStatusTone } from '@/lib/survivor/survivorStatusCard'

const TONE: Record<SurvivorStatusTone, string> = {
  safe: 'border-[rgba(240,163,94,0.3)] bg-[rgba(240,163,94,0.07)]',
  risk: 'border-[rgba(224,86,59,0.45)] bg-[rgba(224,86,59,0.1)]',
  immune: 'border-[rgba(242,196,107,0.45)] bg-[rgba(242,196,107,0.09)]',
  exile: 'border-violet-400/40 bg-violet-500/10',
  jury: 'border-amber-400/40 bg-amber-500/10',
  finalist: 'border-amber-300/60 bg-amber-400/15',
  out: 'border-white/15 bg-white/[0.04]',
}

/** "Your status": where you stand this week and what you can do now. */
export function SurvivorStatusCard({ card }: { card: Card }) {
  return (
    <section aria-label="Your status" data-testid="survivor-status-card" data-tone={card.tone} className={`mt-3 rounded-2xl border p-4 ${TONE[card.tone]}`}>
      <p className="sv-kicker text-[11px]">Your status</p>
      <h2 className="sv-h mt-1 text-lg">{card.headline}</h2>
      <p className="mt-1 text-[13px] text-white/70">{card.detail}</p>
      {card.facts.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {card.facts.map(fact => (
            <div key={fact.label} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <dt className="text-[11px] uppercase tracking-wider text-white/45">{fact.label}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-white">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.actions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.actions.map((action, index) => (
            <Link key={action.label} href={action.href}
              className={`inline-flex min-h-[44px] items-center rounded-lg px-4 text-[13px] font-semibold ${index === 0 ? 'bg-[var(--survivor-torch)] text-[#1a0f05] hover:bg-[#f4b47a]' : 'border border-white/20 text-white hover:border-[rgba(240,163,94,0.55)]'}`}>
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
