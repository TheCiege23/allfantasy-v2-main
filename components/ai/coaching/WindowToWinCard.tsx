'use client'

import { Compass } from 'lucide-react'
import { cn } from '@/lib/utils'

const RISK: Record<'low' | 'medium' | 'high', string> = {
  low: 'rdt-good-line rdt-good-soft rdt-good',
  medium: 'rdt-warn-line rdt-warn-soft rdt-warn',
  high: 'rdt-bad-line rdt-bad-soft rdt-bad',
}

export function WindowToWinCard({
  label,
  risk,
  explanation,
}: {
  label: string
  risk: 'low' | 'medium' | 'high'
  explanation: string
}) {
  return (
    <section className="rounded-2xl border rdt-accent-line p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 rdt-accent" aria-hidden />
          <div>
            <h2 className="text-sm font-bold rdt-text">Window to win</h2>
            <p className="text-[11px] rdt-faint">When to push and how much risk you carry</p>
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
            RISK[risk],
          )}
        >
          Risk: {risk}
        </span>
      </div>
      <p className="mt-4 text-lg font-semibold tracking-tight rdt-accent">{label}</p>
      <p className="mt-2 text-[13px] leading-relaxed rdt-muted">{explanation}</p>
    </section>
  )
}
