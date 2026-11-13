'use client'

import type { BroadcastRivalryRow } from '@/lib/broadcast-engine/types'

interface RivalriesPanelProps {
  rivalries: BroadcastRivalryRow[]
  title?: string
  className?: string
}

export function RivalriesPanel({
  rivalries,
  title = 'Rivalries',
  className = '',
}: RivalriesPanelProps) {
  if (rivalries.length === 0) {
    return (
      <div className={`flex min-h-[160px] flex-col items-center justify-center rounded-2xl bg-black/40 p-6 ${className}`}>
        <h2 className="text-xl font-bold text-white md:text-2xl xl:text-3xl">{title}</h2>
        <p className="mt-2 text-zinc-500">No rivalries yet</p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 rounded-2xl bg-black/40 p-6 md:p-8 xl:p-10 ${className}`}>
      <h2 className="text-xl font-bold text-white md:text-3xl xl:text-4xl">{title}</h2>
      <ul className="space-y-3">
        {rivalries.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-4 xl:p-6"
          >
            <span className="font-semibold text-white md:text-lg xl:text-xl">{r.managerAName}</span>
            <span className="text-amber-400 xl:text-lg">vs</span>
            <span className="font-semibold text-white md:text-lg xl:text-xl">{r.managerBName}</span>
            <span className="w-full text-right text-sm text-zinc-500 md:w-auto xl:text-base">
              {r.eventCount} events · intensity {r.intensityScore.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
