'use client'

import { cn } from '@/lib/utils'
import type { DraftPickRecord } from '../types'

const DEFAULT_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']

const POS_COLOR: Record<string, string> = {
  QB: 'border-red-500/40 bg-red-500/10',
  RB: 'border-emerald-500/40 bg-emerald-500/10',
  WR: 'border-blue-500/40 bg-blue-500/10',
  TE: 'border-orange-500/40 bg-orange-500/10',
  K: 'border-slate-500/40 bg-slate-500/10',
  DEF: 'border-purple-500/40 bg-purple-500/10',
  FLEX: 'border-cyan-500/40 bg-cyan-500/10',
  BN: 'border-white/10 bg-white/[0.03]',
}

type Props = {
  myPicks: DraftPickRecord[]
  label?: string
}

export function RosterPanel({ myPicks, label = 'Your roster' }: Props) {
  const filled = myPicks.filter(Boolean)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]">
      <div className="border-b border-white/[0.06] px-2 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {DEFAULT_SLOTS.map((slot, i) => {
          const pick = filled[i] ?? null
          const base = POS_COLOR[slot] ?? POS_COLOR.BN
          return (
            <div
              key={`${slot}-${i}`}
              className={cn(
                'flex min-h-[36px] items-center rounded border px-2 text-[11px]',
                pick ? base : 'border-dashed border-white/15 bg-transparent text-white/35',
              )}
            >
              <span className="w-10 shrink-0 text-white/40">{slot}</span>
              {pick ? (
                <span className="truncate font-medium text-white/90">{pick.playerName}</span>
              ) : (
                <span className="text-white/25">Empty</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
