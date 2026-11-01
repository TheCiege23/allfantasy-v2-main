'use client'

import { Crown, ListOrdered } from 'lucide-react'
import type { CoachingPlanMode } from '@/lib/ai/coaching/coachingPlanTypes'
import { cn } from '@/lib/utils'

const MODE_STYLES: Record<CoachingPlanMode, string> = {
  contend: 'rdt-good-line rdt-good-soft rdt-good',
  retool: 'rdt-warn-line rdt-warn-soft rdt-warn',
  rebuild: 'rdt-bad-line rdt-bad-soft rdt-bad',
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
      className="rounded-2xl border rdt-line p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-6"
      aria-labelledby="franchise-plan-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border rdt-warn-line rdt-warn-soft">
            <Crown className="h-5 w-5 rdt-warn" aria-hidden />
          </div>
          <div>
            <h2 id="franchise-plan-heading" className="text-sm font-bold tracking-tight rdt-text">
              Franchise plan
            </h2>
            <p className="text-[11px] rdt-faint">Mode, confidence, and priority moves</p>
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
          <span className="rounded-full border rdt-accent-line rdt-accent-soft px-3 py-1 text-[11px] font-semibold rdt-accent">
            {confidence}% confidence
          </span>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed rdt-muted">{explanation}</p>
      <div className="mt-5">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] rdt-faint">
          <ListOrdered className="h-3.5 w-3.5" aria-hidden />
          Priority actions
        </div>
        <ol className="space-y-2">
          {priorityActions.slice(0, 5).map((a, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-xl border rdt-line rdt-well px-3 py-2.5 text-[13px] rdt-text2"
            >
              <span className="font-mono text-[11px] font-bold rdt-accent">{i + 1}</span>
              <span className="leading-snug">{a}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
