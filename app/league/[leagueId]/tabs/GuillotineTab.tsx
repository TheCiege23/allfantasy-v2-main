'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GuillotineHome } from '@/components/guillotine/GuillotineHome'
import type { SupportedSport } from '@/lib/sport-scope'
import '@/components/guillotine/guillotine-identity.css'

type Sub = 'board' | 'team' | 'waivers' | 'history' | 'storylines'

type GuillotineTabProps = {
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
    <div className="gl flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
      <div className="gl-subnav flex flex-wrap gap-2 border-b pb-3">
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
            className="gl-subtab rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'team' ? (
        <div className="gl-card rounded-xl border px-4 py-4">
          <p className="gl-text text-[13px]">Lineups, roster, and trades live in the standard league tabs.</p>
          <Link
            href={`/league/${encodeURIComponent(leagueId)}?view=team`}
            className="gl-accent-text mt-3 inline-flex text-sm font-semibold hover:underline"
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
