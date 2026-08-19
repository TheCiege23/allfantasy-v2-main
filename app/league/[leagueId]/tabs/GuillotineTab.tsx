'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import type { SupportedSport } from '@/lib/sport-scope'

type Sub = 'board' | 'team' | 'waivers' | 'history' | 'storylines'

export type GuillotineTabProps = {
  leagueId: string
  sport: SupportedSport | string
  leagueName?: string | null
}

const SCROLL_ANCHORS: Record<Exclude<Sub, 'board' | 'team'>, string> = {
  waivers: 'guillotine-waivers',
  history: 'guillotine-history',
  storylines: 'guillotine-ai',
}

export function GuillotineTab({ leagueId, sport, leagueName }: GuillotineTabProps) {
  const [sub, setSub] = useState<Sub>('board')

  useEffect(() => {
    if (sub === 'board' || sub === 'team') return
    const id = SCROLL_ANCHORS[sub]
    const t = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(t)
  }, [sub])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4 text-[#e6edf3]">
      <div className="flex flex-wrap gap-2 border-b border-white/[0.08] pb-3">
        {(
          [
            ['board', 'Hub'],
            ['team', 'My Team'],
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
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              sub === id
                ? 'bg-[#ff3d81]/15 text-[#ffd7e5] ring-1 ring-[#ff3d81]/35'
                : 'bg-white/[0.05] text-white/45 hover:bg-white/10 hover:text-white/85'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'team' ? (
        <div className="rounded-xl border border-white/10 bg-[#0a1228]/90 px-4 py-4">
          <p className="text-[13px] text-white/85">Lineups, roster, and trades live in the standard league tabs.</p>
          <Link
            href={`/league/${encodeURIComponent(leagueId)}?view=team`}
            className="mt-3 inline-flex text-sm font-semibold text-[#ff3d81] hover:text-[#ff9ec0]"
            data-testid="guillotine-goto-team"
          >
            Open My Team →
          </Link>
        </div>
      ) : null}

      {sub !== 'team' ? (
        <GuillotineHome leagueId={leagueId} sport={String(sport)} leagueName={leagueName ?? undefined} />
      ) : null}
    </div>
  )
}
