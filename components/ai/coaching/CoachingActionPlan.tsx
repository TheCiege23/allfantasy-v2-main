'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type Section = {
  id: string
  title: string
  urgency: 'now' | 'soon' | 'steady'
  bullets: string[]
  why?: string
}

const URGENCY: Record<Section['urgency'], string> = {
  now: 'rdt-bad-line rdt-bad-soft rdt-bad',
  soon: 'rdt-warn-line rdt-warn-soft rdt-warn',
  steady: 'rdt-good-line rdt-good-soft rdt-good',
}

export function CoachingActionPlan({
  draftStrategy,
  tradeStrategy,
  waiverStrategy,
  devyStrategy,
  pickManagement,
}: {
  draftStrategy: string[]
  tradeStrategy: string[]
  waiverStrategy?: string[]
  devyStrategy?: string[]
  pickManagement: string[]
}) {
  const sections: Section[] = [
    {
      id: 'draft',
      title: 'Draft strategy',
      urgency: 'soon',
      bullets: draftStrategy,
      why: 'Align rookie hits with your timeline and positional leverage.',
    },
    {
      id: 'trade',
      title: 'Trade strategy',
      urgency: 'now',
      bullets: tradeStrategy,
      why: 'Trades should match your mode — consolidate when contending, diversify when rebuilding.',
    },
    {
      id: 'waiver',
      title: 'Waiver / stash',
      urgency: 'steady',
      bullets: waiverStrategy?.length ? waiverStrategy : ['Sync league data for FAAB-aligned targets.'],
      why: 'Cheap edges that protect your window without burning future capital.',
    },
    {
      id: 'devy',
      title: 'Devy strategy',
      urgency: 'steady',
      bullets: devyStrategy?.length ? devyStrategy : ['Devy notes appear when college pipeline data is available.'],
      why: 'Devy is timeline insurance — balance against NFL-ready needs.',
    },
    {
      id: 'picks',
      title: 'Pick management',
      urgency: 'soon',
      bullets: pickManagement,
      why: 'Pick liquidity drives trade leverage — protect firsts unless you are a top-tier contender.',
    },
  ]

  const [open, setOpen] = useState<Record<string, boolean>>({})

  return (
    <section className="rounded-2xl border rdt-line rdt-surface p-5 md:p-6">
      <h2 className="text-sm font-bold rdt-text">Action plan</h2>
      <p className="mt-1 text-[11px] rdt-faint">Draft, trade, waivers, devy, and capital discipline</p>
      <div className="mt-4 space-y-3">
        {sections.map((s) => {
          const expanded = open[s.id] ?? false
          return (
            <div key={s.id} className="rounded-xl border rdt-line rdt-well">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold rdt-text">{s.title}</span>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                      URGENCY[s.urgency],
                    )}
                  >
                    {s.urgency}
                  </span>
                </div>
                {s.why ? (
                  <button
                    type="button"
                    onClick={() => setOpen((m) => ({ ...m, [s.id]: !expanded }))}
                    className="inline-flex items-center gap-1 text-[11px] font-medium rdt-accent"
                  >
                    Why?
                    <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} aria-hidden />
                  </button>
                ) : null}
              </div>
              {expanded && s.why ? (
                <p className="border-t rdt-line px-4 py-2 text-[12px] rdt-muted">{s.why}</p>
              ) : null}
              <ul className="space-y-1.5 border-t rdt-line px-4 py-3">
                {s.bullets.slice(0, 6).map((b, i) => (
                  <li key={i} className="flex gap-2 text-[12px] rdt-muted">
                    <span className="rdt-accent">•</span>
                    <span className="leading-snug">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
