'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { SportGroup, LeagueForGrouping } from '@/lib/dashboard'
import { resolveLeagueHomeHrefFromListRow } from '@/lib/dashboard/league-list-destination'

export interface DashboardSportGroupsProps {
  groups: SportGroup[]
  maxPerGroup?: number
  emptyLeagueLabel?: string
  renderLeagueHref?: (league: LeagueForGrouping) => string
}

/**
 * DashboardSportGroups — visual grouping surface for leagues by sport.
 * Keeps emoji + sport section headers consistent across dashboard views.
 */
export function DashboardSportGroups({
  groups,
  maxPerGroup = 3,
  emptyLeagueLabel = 'Unnamed league',
  renderLeagueHref = (league) => resolveLeagueHomeHrefFromListRow(league),
}: DashboardSportGroupsProps) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.sport}>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <span>{group.emoji}</span>
            <span>{group.label}</span>
          </h4>
          <div className="space-y-2">
            {group.leagues.slice(0, maxPerGroup).map((league) => (
              <Link
                key={league.id}
                href={renderLeagueHref(league)}
                className="group flex items-center justify-between rounded-xl border border-subtle bg-surface-muted p-3 transition hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{league.name || emptyLeagueLabel}</div>
                  <div className="text-xs text-muted">
                    {league.leagueSize ?? '?'}-team · {league.isDynasty ? 'Dynasty' : 'Redraft'}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted group-hover:text-secondary" />
              </Link>
            ))}
            {group.leagues.length > maxPerGroup && (
              <div className="py-1 text-xs text-muted">+{group.leagues.length - maxPerGroup} more</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
