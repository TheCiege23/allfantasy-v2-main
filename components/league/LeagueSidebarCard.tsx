'use client'

import type { HTMLAttributes, MouseEvent } from 'react'
import Link from 'next/link'
import { Star, Trash2 } from 'lucide-react'
import { LeagueAvatar } from '@/app/dashboard/components/LeagueAvatar'
import { buildLeagueFormatLabel, buildStatusConfig } from '@/lib/leagues/leagueFormatLabel'
import type { UserLeague } from '@/app/dashboard/types'
import { getLeagueListDestinationHref } from '@/lib/dashboard/league-list-destination'
import { importedPlatformLabel } from '@/lib/dashboard/platform-label'

export type LeagueSidebarCardProps = {
  league: UserLeague
  /** Illegal roster / lineup issue count (My Leagues rail). */
  rosterIssueCount?: number
  isSelected?: boolean
  isFavorite?: boolean
  onSelect?: (league: UserLeague) => void
  /**
   * Dashboard My Leagues: primary click selects inline (updates `?leagueId=`) instead of navigating away.
   * Tournament hub rows still navigate to `/tournament/[id]`. Middle-/modifier-click follows `href` normally.
   */
  inlineDashboardSelect?: boolean
  onFavoriteToggle?: (leagueId: string) => void
  isDragging?: boolean
  isDropTarget?: boolean
  dragHandleProps?: HTMLAttributes<HTMLDivElement>
  showRefreshButton?: boolean
  isRefreshing?: boolean
  isRefreshed?: boolean
  onRefresh?: (e: MouseEvent, leagueId: string) => void
  /** Remove from My Leagues (AllFantasy row only) */
  onDelete?: (e: MouseEvent, leagueId: string) => void
  isDeleting?: boolean
  /** Tighter layout for right-rail / compact panels */
  compact?: boolean
}

export function LeagueSidebarCard({
  league,
  rosterIssueCount = 0,
  isSelected = false,
  isFavorite = false,
  onSelect,
  onFavoriteToggle,
  isDragging = false,
  isDropTarget = false,
  dragHandleProps,
  showRefreshButton = false,
  isRefreshing = false,
  isRefreshed = false,
  onRefresh,
  onDelete,
  isDeleting = false,
  compact = false,
  inlineDashboardSelect = false,
}: LeagueSidebarCardProps) {
  const formatLabel = buildLeagueFormatLabel({
    format: league.format,
    scoring: league.scoring,
    isDynasty: league.isDynasty,
    leagueVariant: league.leagueVariant,
    teamCount: league.teamCount,
    season: league.season,
  })

  const status = buildStatusConfig(league.status)
  const sportLabel = (league.sport || 'NFL').toString().toUpperCase()
  const platformLabel = getPlatformLabel(league.platform)
  const destinationHref = getLeagueListDestinationHref(league)
  const tournamentHubNav = destinationHref.startsWith('/tournament/')
  const inlineSelectActive = Boolean(inlineDashboardSelect && onSelect && !tournamentHubNav)

  return (
    <div
      className={[
        'group relative w-full min-w-0',
        isDragging ? 'opacity-40' : '',
        isDropTarget ? 'rounded-xl ring-1 ring-cyan-500/40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showRefreshButton || onDelete ? (
        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5">
          {showRefreshButton ? (
            <button
              type="button"
              onClick={(e) => onRefresh?.(e, league.id)}
              title="Refresh from Sleeper"
              className={[
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] transition-all',
                isRefreshing
                  ? 'cursor-wait bg-cyan-500/20 text-cyan-400'
                  : isRefreshed
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-white/[0.06] text-white/35 opacity-0 hover:bg-white/[0.12] hover:text-white group-hover:opacity-100',
              ].join(' ')}
              aria-label="Refresh league from Sleeper"
            >
              {isRefreshing ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-cyan-400 border-t-transparent" />
              ) : isRefreshed ? (
                '✓'
              ) : (
                '↻'
              )}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              data-testid="dashboard-league-delete"
              onClick={(e) => onDelete(e, league.id)}
              disabled={isDeleting}
              title="Remove from My Leagues"
              className={[
                'flex h-5 w-5 items-center justify-center rounded-full border border-transparent text-white/35 transition-all',
                'hover:border-red-500/35 hover:bg-red-500/15 hover:text-red-300',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                isDeleting ? 'cursor-wait opacity-100' : '',
              ].join(' ')}
              aria-label="Remove league from My Leagues"
            >
              {isDeleting ? (
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-red-400 border-t-transparent" />
              ) : (
                <Trash2 className="h-3 w-3" strokeWidth={2} />
              )}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex w-full min-w-0 items-stretch gap-1.5">
        {dragHandleProps ? (
          <div
            {...dragHandleProps}
            className={[
              // De-noise: the reorder handle only appears on hover/focus.
              'flex w-3.5 shrink-0 cursor-grab select-none items-center justify-center self-stretch rounded-sm text-white/20 opacity-0 transition-opacity hover:text-white/50 focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100',
              dragHandleProps.className,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="Reorder"
          >
            <span className="flex flex-col items-center gap-0 text-[8px] leading-[0.7]">
              <span>⋮</span>
              <span>⋮</span>
            </span>
          </div>
        ) : null}

        <Link
          href={destinationHref}
          aria-label={`${league.name} — ${status.label}`}
          aria-current={isSelected ? 'page' : undefined}
          onClick={(e) => {
            if (inlineSelectActive) {
              e.preventDefault()
              onSelect?.(league)
            } else {
              onSelect?.(league)
            }
          }}
          className={[
            // Broadcast Deck row: deck panel + solid gradient left rail when active.
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 outline-none transition-all duration-150',
            'border border-l-[3px] focus-visible:ring-2 focus-visible:ring-[#ff3d81]/40',
            compact ? 'min-h-[52px] py-2' : 'py-2.5',
            isSelected
              ? 'border-[#262c6a] border-l-[#ff3d81] bg-[#12163e] shadow-[0_2px_14px_rgba(255,61,129,0.10)]'
              : 'border-transparent border-l-transparent hover:border-[#262c6a] hover:bg-[#12163e]/70',
          ].join(' ')}
        >
          <div className="shrink-0">
            <LeagueAvatar league={league} size={compact ? 24 : 36} />
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <p
                className={`min-w-0 flex-1 truncate font-extrabold leading-tight tracking-tight ${
                  isSelected ? 'text-[#f0f2ff]' : 'text-white/90'
                } ${compact ? 'text-[14px]' : 'text-[13px]'}`}
              >
                {league.name}
              </p>
              {rosterIssueCount > 0 ? (
                <span
                  className="min-w-[1.125rem] shrink-0 rounded-full bg-amber-500/95 px-1 py-0.5 text-center text-[9px] font-extrabold text-[#050814]"
                  title="Roster or lineup issues"
                  data-testid={`league-sidebar-roster-issues-${league.id}`}
                >
                  {rosterIssueCount > 99 ? '99+' : rosterIssueCount}
                </span>
              ) : null}
              {league.isCommissioner ? (
                <span
                  className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-1 py-0.5 text-[8px] font-bold text-amber-300"
                  title="You are Commissioner"
                >
                  COMM
                </span>
              ) : null}
              {league.isDynasty ? (
                <span
                  className="shrink-0 rounded border border-violet-500/30 bg-violet-500/15 px-1 py-0.5 text-[8px] font-bold text-violet-300"
                  title="Dynasty league"
                >
                  DYN
                </span>
              ) : null}
              {league.isPaid ? (
                <span className="shrink-0 rounded border border-emerald-500/25 bg-emerald-500/10 px-1 py-0.5 text-[8px] font-semibold text-emerald-400">
                  Paid
                </span>
              ) : null /* de-noise: "Free" on every row said nothing */}
              {league.lifecycleState === 'renewal_pending' && (
                <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 text-[8px] font-bold text-amber-300" title="League renewal window is open">
                  RENEW
                </span>
              )}
              {league.lifecycleState === 'offseason' && (
                <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 text-[8px] font-medium text-white/30">
                  OFF
                </span>
              )}
              {league.lifecycleState === 'archived' && (
                <span className="shrink-0 rounded bg-white/[0.04] px-1 py-0.5 text-[8px] font-medium text-white/20">
                  ARC
                </span>
              )}
              {league.importedAt && !league.lifecycleState && (
                <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-1 py-0.5 text-[8px] font-medium text-sky-400/70" title="Imported league">
                  IMP
                </span>
              )}
            </div>

            <p className="truncate text-[11px] leading-tight text-white/45">
              {formatLabel || `${sportLabel} · ${league.teamCount}-Team`}
            </p>

            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${status.dotColor}`} />
              <span className={`text-[10px] font-semibold tracking-wide ${status.textColor}`}>{status.label}</span>
              {league.status === 'in_season' && league.currentWeek != null ? (
                <span className="shrink-0 rounded-full border border-cyan-500/25 bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                  Wk {league.currentWeek}
                </span>
              ) : null}
              <span className="text-[10px] text-white/20">·</span>
              <span className={`truncate text-[10px] font-medium ${getPlatformColor(league.platform)}`}>
                {platformLabel}
              </span>
            </div>
          </div>
        </Link>

        {onFavoriteToggle ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onFavoriteToggle(league.id)
            }}
            className={`shrink-0 text-white/35 transition hover:text-white/80 ${
              compact ? 'self-center p-0.5' : 'self-start pt-2 text-sm leading-none'
            } ${isFavorite ? '' : 'opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100'}`}
            aria-label={isFavorite ? 'Remove favorite' : 'Add favorite'}
          >
            {compact ? (
              <Star
                className={`h-3 w-3 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-white/55'}`}
                strokeWidth={isFavorite ? 0 : 1.5}
              />
            ) : isFavorite ? (
              <span className="text-amber-400">★</span>
            ) : (
              <span>☆</span>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The sidebar chip labels native leagues 'AF' on purpose (it's a badge, so it always shows
 * something) — unlike the name suffix, which omits the platform entirely for native leagues.
 * The platform spellings themselves come from the shared helper so there is one map, not two:
 * this one silently returned 'AF' for any unlisted platform, which mislabelled Fleaflicker
 * imports as AllFantasy.
 */
function getPlatformLabel(platform: string | undefined): string {
  return importedPlatformLabel(platform) ?? 'AF'
}

function getPlatformColor(platform: string | undefined): string {
  const p = (platform ?? '').toLowerCase()
  if (p === 'sleeper') return 'text-emerald-400/70'
  if (p === 'yahoo') return 'text-violet-400/70'
  if (p === 'espn') return 'text-red-400/70'
  return 'text-white/35'
}
