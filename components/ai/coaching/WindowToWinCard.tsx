'use client'

import { Compass } from 'lucide-react'
import { cn } from '@/lib/utils'

const RISK: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
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
    <section className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.07] to-[#070d18] p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-sky-300" aria-hidden />
          <div>
            <h2 className="text-sm font-bold text-white">Window to win</h2>
            <p className="text-[11px] text-white/45">When to push and how much risk you carry</p>
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
      <p className="mt-4 text-lg font-semibold tracking-tight text-sky-100/95">{label}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-white/70">{explanation}</p>
    </section>
  )
}
