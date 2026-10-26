'use client'

import Link from 'next/link'
import type { SurvivorStatusCard as Card, SurvivorStatusTone } from '@/lib/survivor/survivorStatusCard'

const TONE: Record<SurvivorStatusTone, string> = {
  safe: 'border-emerald-400/30 bg-emerald-500/10',
  risk: 'border-red-400/40 bg-red-500/10',
  immune: 'border-cyan-400/40 bg-cyan-500/10',
  exile: 'border-violet-400/40 bg-violet-500/10',
  jury: 'border-amber-400/40 bg-amber-500/10',
  finalist: 'border-amber-300/60 bg-amber-400/15',
  out: 'border-white/15 bg-white/[0.04]',
}

/** "Your status": where you stand this week and what you can do now. */
export function SurvivorStatusCard({ card }: { card: Card }) {
  return (
    <section aria-label="Your status" data-testid="survivor-status-card" data-tone={card.tone} className={`mt-3 rounded-2xl border p-4 ${TONE[card.tone]}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-white/55">Your status</p>
      <h2 className="mt-1 text-lg font-bold text-white">{card.headline}</h2>
      <p className="mt-1 text-[13px] text-white/70">{card.detail}</p>
      {card.facts.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {card.facts.map(fact => (
            <div key={fact.label} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wider text-white/45">{fact.label}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-white">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.actions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.actions.map((action, index) => (
            <Link key={action.label} href={action.href}
              className={`inline-flex min-h-[44px] items-center rounded-lg px-4 text-[13px] font-semibold ${index === 0 ? 'bg-amber-400 text-black' : 'border border-white/20 text-white'}`}>
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
