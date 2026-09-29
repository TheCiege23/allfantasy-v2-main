'use client'

import Link from 'next/link'
import { TrendingDown, TrendingUp, Minus, Sparkles, AlertTriangle, GitCompare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackPlayerComparisonUsage } from '@/lib/analytics/player-comparison-analytics'
import type { LineupRosterPlayer, PlayerCardVariant } from './types'

export interface PlayerLineupCardProps {
  player: LineupRosterPlayer
  slotLabel: string
  variant: PlayerCardVariant
  swapPriority?: number
  benchBadge?: 'consider_start' | 'high_upside' | 'safe_alt' | null
  aiRecommended?: boolean
  onClick?: () => void
  compact?: boolean
  /** When set, show Compare link to Start A vs B tool with this player prefilled */
  sport?: string | null
}

function statusTone(status?: string): string {
  const s = (status ?? '').toLowerCase()
  if (s.includes('out') || s.includes('ir')) return 'text-red-300'
  if (s.includes('questionable') || s.includes('doubtful')) return 'text-amber-300'
  return 'text-emerald-300/90'
}

export function PlayerLineupCard({
  player,
  slotLabel,
  variant,
  swapPriority,
  benchBadge,
  aiRecommended,
  onClick,
  compact,
  sport = null,
}: PlayerLineupCardProps) {
  const borderGlow =
    variant === 'strong'
      ? 'border-emerald-400/35 shadow-[0_0_20px_rgba(52,211,153,0.12)]'
      : variant === 'risk'
        ? 'border-amber-400/35 shadow-[0_0_16px_rgba(251,191,36,0.08)]'
        : variant === 'inactive'
          ? 'border-white/10 opacity-55 grayscale'
          : 'border-white/12'

  const compareHref =
    sport && player.name
      ? `/tools/player-decision?${new URLSearchParams({ sport, playerA: player.name }).toString()}`
      : null

  return (
    <div className="flex gap-1.5">
    <button
      type="button"
      onClick={onClick}
      data-testid={`lineup-player-card-${player.id}`}
      className={cn(
        'group min-w-0 flex-1 rounded-xl border bg-[#0a1228]/95 text-left transition-all duration-200',
        'hover:border-cyan-400/30 hover:bg-[#0d1530]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400/50',
        borderGlow,
        compact ? 'p-2' : 'p-3'
      )}
    >
      <div className="flex gap-3">
        <div
          className={cn(
            'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700/80 to-slate-900 text-sm font-semibold text-white/90',
            variant === 'strong' && 'ring-1 ring-emerald-400/40',
            variant === 'inactive' && 'opacity-60'
          )}
          aria-hidden
        >
          {player.name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 3)}
          {aiRecommended ? (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500/90 text-[11px] text-[#040915]">
              <Sparkles className="h-3 w-3" aria-hidden />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200/80">{slotLabel}</p>
              <p className="truncate font-medium text-white">{player.name}</p>
              <p className="text-xs text-white/55">
                {player.team ?? '—'} · {player.opponent ?? '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-white">{player.projectedPoints.toFixed(1)}</p>
              <p className="text-[11px] text-white/45">proj</p>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className={cn('font-medium', statusTone(player.injuryStatus))}>{player.injuryStatus ?? '—'}</span>
            {player.gameTime ? <span className="text-white/40">{player.gameTime}</span> : null}
            <span className="inline-flex items-center gap-0.5 text-white/50">
              {player.trend === 'up' ? (
                <TrendingUp className="h-3 w-3 text-emerald-400" aria-label="trending up" />
              ) : player.trend === 'down' ? (
                <TrendingDown className="h-3 w-3 text-rose-400" aria-label="trending down" />
              ) : (
                <Minus className="h-3 w-3 text-white/35" aria-label="flat" />
              )}
            </span>
            {variant === 'risk' ? (
              <span className="inline-flex items-center gap-0.5 text-amber-200/90">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                risk
              </span>
            ) : null}
            {swapPriority != null ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/50">Swap {swapPriority.toFixed(0)}</span>
            ) : null}
            {benchBadge === 'consider_start' ? (
              <span className="rounded border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-100">
                Consider starting
              </span>
            ) : null}
            {benchBadge === 'high_upside' ? (
              <span className="rounded border border-violet-400/25 bg-violet-400/10 px-1.5 py-0.5 text-violet-100">
                High upside
              </span>
            ) : null}
            {benchBadge === 'safe_alt' ? (
              <span className="rounded border border-slate-400/25 bg-slate-400/10 px-1.5 py-0.5 text-slate-100">
                Safe alt
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
      {compareHref ? (
        <Link
          href={compareHref}
          onClick={(e) => {
            e.stopPropagation()
            trackPlayerComparisonUsage({
              event: 'player_comparison_lineup_launch',
              meta: { player: player.name, sport },
            })
          }}
          className="flex h-[44px] w-11 shrink-0 items-center justify-center self-center rounded-xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
          aria-label={`Compare ${player.name}`}
          data-testid={`lineup-player-compare-${player.id}`}
        >
          <GitCompare className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  )
}

export function mapEngineToCardVariant(
  startConfidence: number,
  volatility: number,
  injuryStatus?: string
): PlayerCardVariant {
  const s = (injuryStatus ?? '').toLowerCase()
  if (s.includes('out') || s.includes('ir') || s.includes('suspended')) return 'inactive'
  if (startConfidence >= 72 && volatility < 55) return 'strong'
  if (startConfidence < 52 || volatility > 72) return 'risk'
  return 'neutral'
}
