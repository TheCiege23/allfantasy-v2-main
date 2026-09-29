'use client'

import { Crown, ListOrdered } from 'lucide-react'
import type { CoachingPlanMode } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

const MODE_STYLES: Record<CoachingPlanMode, string> = {
  contend: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-100',
  retool: 'border-amber-500/35 bg-amber-500/10 text-amber-100',
  rebuild: 'border-rose-500/35 bg-rose-500/10 text-rose-100',
}

function modeLabel(m: CoachingPlanMode): string {
  if (m === 'contend') return 'Contend'
  if (m === 'rebuild') return 'Rebuild'
  return 'Retool'
}

export function FranchisePlanCard({
  mode,
  confidence,
  explanation,
  priorityActions,
}: {
  mode: CoachingPlanMode
  confidence: number
  explanation: string
  priorityActions: string[]
}) {
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0a1428]/90 to-[#070d18] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-6"
      aria-labelledby="franchise-plan-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
            <Crown className="h-5 w-5 text-amber-200/90" aria-hidden />
          </div>
          <div>
            <h2 id="franchise-plan-heading" className="text-sm font-bold tracking-tight text-white">
              Franchise plan
            </h2>
            <p className="text-[11px] text-white/45">Mode, confidence, and priority moves</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide',
              MODE_STYLES[mode],
            )}
          >
            {modeLabel(mode)}
          </span>
          <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
            {confidence}% confidence
          </span>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-white/75">{explanation}</p>
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
          <ListOrdered className="h-3.5 w-3.5" aria-hidden />
          Priority actions
        </div>
        <ol className="space-y-2">
          {priorityActions.slice(0, 5).map((a, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5 text-[13px] text-white/80"
            >
              <span className="font-mono text-[11px] font-bold text-cyan-400/90">{i + 1}</span>
              <span className="leading-snug">{a}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
