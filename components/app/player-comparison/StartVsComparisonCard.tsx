'use client'

import Link from 'next/link'
import { Loader2, Trophy } from 'lucide-react'
import PlayerHeadshot from '@/components/league/PlayerHeadshot'
import { cn } from '@/lib/utils'
import type { StartVsApiResponse, StartVsStrategyMode } from '@/lib/player-comparison-lab'
import { Button } from '@/components/ui/button'

const STRATEGY_LABEL: Record<StartVsStrategyMode, string> = {
  safest_floor: 'Safest floor',
  balanced: 'Balanced',
  highest_upside: 'Highest upside',
  underdog_mode: 'Underdog',
  protect_lead: 'Protect lead',
}

export interface StartVsComparisonCardProps {
  data: StartVsApiResponse | null
  loading?: boolean
  error?: string | null
  /** When set, card shows upside vs floor recommendation for this strategy */
  strategyMode: StartVsStrategyMode
  onStrategyChange?: (mode: StartVsStrategyMode) => void
  onOpenFull?: () => void
  className?: string
}

function winnerName(d: StartVsApiResponse): string {
  if (d.winner === 'tie') return 'Too close to call'
  return d.winner === 'playerA' ? d.playerA.name : d.playerB.name
}

export function StartVsComparisonCard({
  data,
  loading,
  error,
  strategyMode,
  onStrategyChange,
  onOpenFull,
  className,
}: StartVsComparisonCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          'flex min-h-[200px] items-center justify-center rounded-2xl border border-white/10 bg-[#0a1228]/90 p-6 text-white/70 backdrop-blur-md',
          className
        )}
        data-testid="start-vs-card-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-sky-400/90" aria-hidden />
        <span className="sr-only">Loading comparison</span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={cn(
          'rounded-2xl border border-red-500/25 bg-red-950/30 p-4 text-sm text-red-100/90 backdrop-blur-md',
          className
        )}
        data-testid="start-vs-card-error"
      >
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div
        className={cn(
          'rounded-2xl border border-white/10 bg-[#0a1228]/60 p-4 text-sm text-white/55 backdrop-blur-md',
          className
        )}
        data-testid="start-vs-card-empty"
      >
        Pick two players to compare.
      </div>
    )
  }

  const aShot = data.display?.playerA?.headshotUrl ?? null
  const bShot = data.display?.playerB?.headshotUrl ?? null
  const showUpside = strategyMode === 'highest_upside' || strategyMode === 'underdog_mode'
  const showFloor = strategyMode === 'safest_floor' || strategyMode === 'protect_lead'
  const recSide = showUpside ? data.upside_pick : showFloor ? data.floor_pick : null
  const recLabel =
    recSide === null
      ? null
      : recSide === 'tie'
        ? 'Even'
        : recSide === 'playerA'
          ? data.playerA.name.split(' ').pop()
          : data.playerB.name.split(' ').pop()

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-[#0a1228]/95 to-[#040915]/95 p-4 shadow-xl backdrop-blur-md sm:p-5',
        className
      )}
      data-testid="start-vs-comparison-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/45">
          Start A vs B
        </div>
        {onOpenFull && (
          <button
            type="button"
            onClick={onOpenFull}
            className="text-xs font-medium text-sky-400/90 hover:text-sky-300"
            data-testid="start-vs-open-full"
          >
            Details
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <PlayerFace
          label="Player A"
          name={data.playerA.name}
          headshotUrl={aShot}
          highlight={data.winner === 'playerA'}
        />
        <PlayerFace
          label="Player B"
          name={data.playerB.name}
          headshotUrl={bShot}
          highlight={data.winner === 'playerB'}
        />
      </div>

      <div
        className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.07] p-3 text-left shadow-inner"
        data-testid="start-vs-coach-snapshot"
      >
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sky-200/90">Coach snapshot</p>
        <p className="text-sm leading-relaxed text-white/92">{data.coach_lens.concise_explanation}</p>
        <dl className="mt-3 grid grid-cols-1 gap-0 text-[11px] sm:grid-cols-2">
          <CoachRow label="Median play" pick={data.coach_lens.median_play} />
          <CoachRow label="Safer play" pick={data.coach_lens.safer_play} />
          <CoachRow label="Higher ceiling" pick={data.coach_lens.higher_ceiling_play} />
          <CoachRow label="If favored / safe" pick={data.coach_lens.better_if_favored} />
          <CoachRow label="If underdog / chase" pick={data.coach_lens.better_if_underdog} />
          <div className="flex justify-between gap-2 border-b border-white/5 py-1 sm:col-span-2">
            <dt className="text-white/45">Confidence</dt>
            <dd className="font-semibold text-sky-200/95">{data.coach_lens.confidence_pct}%</dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-500/5 px-3 py-2">
        <Trophy className="h-4 w-4 shrink-0 text-amber-400/90" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{winnerName(data)}</p>
          <p className="text-xs text-white/55">{data.short_verdict}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-sky-300/95">
          {data.coach_lens.confidence_pct}%
        </span>
      </div>

      <div className="mt-3">
        <ConfidenceMeter pct={data.coach_lens.confidence_pct} />
      </div>

      {onStrategyChange && (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="start-vs-strategy-toggle">
          {(
            [
              ['floor', 'safest_floor'],
              ['balanced', 'balanced'],
              ['upside', 'highest_upside'],
            ] as const
          ).map(([label, mode]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onStrategyChange(mode)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                strategyMode === mode
                  ? 'border-sky-400/50 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20'
              )}
            >
              {label === 'floor' ? 'Floor' : label === 'upside' ? 'Upside' : 'Balanced'}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-white/50">
        Strategy: <span className="text-white/75">{STRATEGY_LABEL[strategyMode]}</span>
        {' · '}
        {strategyMode === 'balanced'
          ? `${data.if_need_floor} · ${data.if_need_upside}`
          : showUpside
            ? data.if_need_upside
            : showFloor
              ? data.if_need_floor
              : data.short_verdict}
      </p>

      <p className="mt-2 text-xs text-sky-200/80">
        {recSide === null
          ? `Verdict: ${winnerName(data)} (${data.coach_lens.confidence_pct}% confidence).`
          : recSide === 'tie'
            ? 'Floor/upside: toss-up on this lens.'
            : `If you need ${showUpside ? 'ceiling' : 'stability'}, lean ${recLabel}.`}
      </p>

      {data.missing_data.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-200/80">
          {data.missing_data.slice(0, 3).map((m) => (
            <li key={m}>• {m}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          asChild
          className="flex-1 bg-sky-500/90 text-[#040915] hover:bg-sky-400"
          data-testid="start-vs-cta-lineup"
        >
          <Link href={data.actions.set_lineup.href}>{data.actions.set_lineup.label}</Link>
        </Button>
        <Button asChild variant="outline" className="flex-1 border-white/15 bg-white/[0.04] text-white/90">
          <Link href={data.actions.compare_again.href}>{data.actions.compare_again.label}</Link>
        </Button>
        <Button asChild variant="ghost" className="text-sky-300/90 hover:text-sky-200">
          <Link href={data.actions.ask_chimmy.href}>{data.actions.ask_chimmy.label}</Link>
        </Button>
      </div>
    </div>
  )
}

function PlayerFace({
  label,
  name,
  headshotUrl,
  highlight,
}: {
  label: string
  name: string
  headshotUrl: string | null
  highlight: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 text-center',
        highlight ? 'border-sky-400/35 bg-sky-500/10' : 'border-white/10 bg-white/[0.03]'
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">{label}</p>
      <div className="mt-2 flex justify-center">
        <PlayerHeadshot src={headshotUrl} alt={name} size={56} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-white">{name}</p>
    </div>
  )
}

function CoachRow({
  label,
  pick,
}: {
  label: string
  pick: { side: string; player_name: string | null }
}) {
  const text = pick.side === 'tie' ? 'Toss-up' : pick.player_name ?? '—'
  return (
    <div className="flex justify-between gap-2 border-b border-white/[0.06] py-1.5">
      <dt className="text-white/50">{label}</dt>
      <dd className="text-right font-medium text-white/90">{text}</dd>
    </div>
  )
}

function ConfidenceMeter({ pct }: { pct: number }) {
  const w = Math.max(8, Math.min(100, pct))
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] uppercase tracking-wide text-white/40">
        <span>Confidence</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-600/80 to-cyan-400/90 transition-all"
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  )
}
