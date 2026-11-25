'use client'

import { useEffect, useState } from 'react'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import type { SupportedSport } from '@/lib/sport-scope'
import '@/components/guillotine/guillotine-identity.css'

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
      const el = document.getElementById(id)
      // A folded target (Guilly Chimmy is a closed row since 2026-11-24) opens on the way there.
      const fold = el instanceof HTMLDetailsElement ? el : el?.querySelector('details')
      if (fold) fold.open = true
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(t)
  }, [sub])

  return (
    <div className="gl flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      {/* One line at every width: a phone scrolls it sideways rather than wrapping it onto a second row. There is
          no "My Team" here — it only linked to the workspace's own My team view, which the Section picker offers. */}
      <div className="gl-subnav flex flex-nowrap gap-2 overflow-x-auto border-b pb-3 [scrollbar-width:none]">
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
            className="gl-subtab shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <GuillotineHome leagueId={leagueId} sport={String(sport)} leagueName={leagueName ?? undefined} />
    </div>
  )
}
