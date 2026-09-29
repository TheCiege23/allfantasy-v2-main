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
  now: 'border-rose-500/35 bg-rose-500/10 text-rose-100',
  soon: 'border-amber-500/35 bg-amber-500/10 text-amber-100',
  steady: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
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
    <section className="rounded-2xl border border-white/[0.08] bg-[#070d18] p-5 md:p-6">
      <h2 className="text-sm font-bold text-white">Action plan</h2>
      <p className="mt-1 text-[11px] text-white/45">Draft, trade, waivers, devy, and capital discipline</p>
      <div className="mt-4 space-y-3">
        {sections.map((s) => {
          const expanded = open[s.id] ?? false
          return (
            <div key={s.id} className="rounded-xl border border-white/[0.06] bg-black/25">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-white">{s.title}</span>
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
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-cyan-300/90 hover:text-cyan-200"
                  >
                    Why?
                    <ChevronDown className={cn('h-3.5 w-3.5 transition', expanded && 'rotate-180')} aria-hidden />
                  </button>
                ) : null}
              </div>
              {expanded && s.why ? (
                <p className="border-t border-white/[0.05] px-4 py-2 text-[12px] text-white/55">{s.why}</p>
              ) : null}
              <ul className="space-y-1.5 border-t border-white/[0.05] px-4 py-3">
                {s.bullets.slice(0, 6).map((b, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-white/70">
                    <span className="text-cyan-500/80">•</span>
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
