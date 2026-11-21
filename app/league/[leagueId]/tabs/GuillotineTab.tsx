'use client'

import { useEffect, useState } from 'react'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import type { SupportedSport } from '@/lib/sport-scope'

type Sub = 'board' | 'waivers' | 'history' | 'storylines'

type GuillotineTabProps = {
  leagueId: string
  sport: SupportedSport | string
  leagueName?: string | null
}

const SCROLL_ANCHORS: Record<Exclude<Sub, 'board'>, string> = {
  waivers: 'guillotine-waivers',
  history: 'guillotine-history',
  storylines: 'guillotine-ai',
}

export function GuillotineTab({ leagueId, sport, leagueName }: GuillotineTabProps) {
  const [sub, setSub] = useState<Sub>('board')

  useEffect(() => {
    if (sub === 'board') return
    const id = SCROLL_ANCHORS[sub]
    const t = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(t)
  }, [sub])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4 text-[#e6edf3]">
      {/* One line at every width: a phone scrolls it sideways rather than wrapping it onto a second row. There is
          no "My Team" here — it only linked to the workspace's own My team view, which the Section picker offers. */}
      <div className="flex flex-nowrap gap-2 overflow-x-auto border-b border-white/[0.08] pb-3 [scrollbar-width:none]">
        {(
          [
            ['board', 'Hub'],
            ['waivers', 'Waivers'],
            ['history', 'History'],
            ['storylines', 'Storylines'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`guillotine-sub-${id}`}
            aria-pressed={sub === id}
            onClick={() => setSub(id)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              sub === id
                ? 'bg-[#ff3d81]/15 text-[#ffd7e5] ring-1 ring-[#ff3d81]/35'
                : 'bg-white/[0.05] text-white/45 hover:bg-white/10 hover:text-white/85'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <GuillotineHome leagueId={leagueId} sport={String(sport)} leagueName={leagueName ?? undefined} />
    </div>
  )
}
