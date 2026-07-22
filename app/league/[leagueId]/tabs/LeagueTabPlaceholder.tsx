'use client'

import type { UserLeague } from '@/app/dashboard/types'
import { leagueTabSportEmoji } from '@/app/league/[leagueId]/LeagueTabs'

export function LeagueTabPlaceholder({
  league,
  tabLabel,
  message,
}: {
  league: UserLeague
  tabLabel: string
  message?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
      <span className="text-4xl" aria-hidden>
        {leagueTabSportEmoji(String(league.sport))}
      </span>
      <p className="text-[14px] font-semibold text-white/60">{tabLabel}</p>
      <p className="max-w-[220px] text-center text-[11px] text-white/30">
        {message ?? `${league.sport} ${tabLabel.toLowerCase()} coming soon`}
      </p>
    </div>
  )
}
