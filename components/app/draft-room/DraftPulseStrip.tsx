'use client'

/**
 * Draft pulse — a compact strip above the board: the last few picks with their
 * value vs market ADP, the current position run, and the viewer's running
 * value vs ADP. All numbers come from `lib/draft-room/draftPulse`.
 */

import React, { useMemo } from 'react'
import { positionColor } from '@/lib/draft/positions'
import {
  buildAdpLookup,
  detectPositionRun,
  formatAdpDelta,
  isFilledPick,
  pickAdpDelta,
  positionTierRemaining,
  recentPickPositions,
  summarizeDraftValue,
  type PulsePick,
  type PulsePoolPlayer,
} from '@/lib/draft-room/draftPulse'

export type DraftPulseStripProps = {
  picks: readonly PulsePick[]
  /** Full pool (drafted + available) — ADP lookup source. */
  pool: readonly PulsePoolPlayer[]
  /** Players still on the board — tier-remaining source. */
  available: readonly PulsePoolPlayer[]
  teamCount: number
  currentOverall: number | null
  viewerRosterId: string | null
  sport?: string
  formatPickLabel: (overall: number) => string
}

const RECENT_COUNT = 5
const RUN_DOTS = 8

function PositionChip({ pos, sport }: { pos: string; sport?: string }) {
  return (
    <span
      className="inline-flex h-[18px] items-center rounded px-1 text-[11px] font-bold tracking-wide text-[#0a111d]"
      style={{ backgroundColor: positionColor(pos, sport) }}
    >
      {pos}
    </span>
  )
}

function deltaTone(delta: number | null): string {
  if (delta == null || Math.abs(delta) < 1) return 'text-white/55'
  return delta > 0 ? 'text-emerald-300' : 'text-rose-300'
}

function deltaLabel(delta: number | null): string {
  if (delta == null) return 'No ADP'
  if (Math.abs(delta) < 1) return 'On ADP'
  return delta > 0 ? `Value ${formatAdpDelta(delta)}` : `Reach ${formatAdpDelta(delta)}`
}

function DraftPulseStripInner({
  picks,
  pool,
  available,
  teamCount,
  currentOverall,
  viewerRosterId,
  sport,
  formatPickLabel,
}: DraftPulseStripProps) {
  const lookup = useMemo(() => buildAdpLookup(pool), [pool])
  // While the pool is still loading (or a sport has no market ADP at all) every
  // lookup misses; labelling each pick "No ADP" then reads as bad data. Show none.
  const poolHasAdp = useMemo(
    () => pool.some((p) => typeof p.adp === 'number' && Number.isFinite(p.adp) && p.adp > 0),
    [pool],
  )

  const recent = useMemo(
    () =>
      picks
        .filter(isFilledPick)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, RECENT_COUNT)
        .map((p) => ({ pick: p, delta: pickAdpDelta(p.overall, lookup(p)) })),
    [picks, lookup],
  )

  const run = useMemo(() => detectPositionRun(picks), [picks])
  const dots = useMemo(() => recentPickPositions(picks, RUN_DOTS), [picks])
  const tierLeft = useMemo(() => {
    if (!run || currentOverall == null) return []
    return positionTierRemaining(available, run.position, currentOverall, Math.max(1, teamCount))
  }, [run, available, currentOverall, teamCount])

  const value = useMemo(() => summarizeDraftValue(picks, lookup, viewerRosterId), [picks, lookup, viewerRosterId])

  if (recent.length === 0) return null

  return (
    <section
      aria-label="Draft pulse"
      data-testid="draft-pulse-strip"
      className="flex w-full shrink-0 flex-wrap gap-1.5 lg:gap-2"
    >
      <div className="min-w-0 flex-[2_1_360px] rounded-lg border border-white/8 bg-[#0d1524]/90 px-2.5 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Recent picks</p>
        <ol className="mt-1.5 flex gap-1.5 overflow-hidden">
          {recent.map(({ pick, delta }) => (
            <li
              key={pick.overall}
              className="flex min-w-[88px] flex-1 flex-col gap-0.5 rounded-md bg-white/[0.04] px-2 py-1.5"
              data-testid="draft-pulse-recent-pick"
            >
              <span className="flex items-center justify-between gap-1">
                <PositionChip pos={pick.position} sport={sport} />
                <span className="text-[11px] text-white/45">{formatPickLabel(pick.overall)}</span>
              </span>
              <span className="truncate text-[12px] font-semibold text-white" title={pick.playerName}>
                {pick.playerName}
              </span>
              {poolHasAdp ? (
                <span className={`text-[11px] font-semibold ${deltaTone(delta)}`}>{deltaLabel(delta)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <div
        className={`min-w-0 flex-[1_1_220px] rounded-lg border px-2.5 py-2 ${
          run ? 'border-amber-400/40 bg-amber-500/[0.08]' : 'border-white/8 bg-[#0d1524]/90'
        }`}
        data-testid="draft-pulse-run"
        role={run ? 'status' : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${run ? 'text-amber-300' : 'text-white/50'}`}>
            Position run
          </p>
          <span className="flex gap-0.5" aria-hidden>
            {dots.map((pos, i) => (
              <span key={i} className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: positionColor(pos, sport) }} />
            ))}
          </span>
        </div>
        {run ? (
          <>
            <p className="mt-1 text-[15px] font-bold text-white">
              {run.position} run · {run.length} straight
            </p>
            <p className="mt-0.5 text-[11px] text-white/70">
              {tierLeft.length > 0
                ? `${tierLeft.length} ${run.position} left with ADP inside the next ${teamCount} picks. ${tierLeft[0]!.name} is next.`
                : `No ${run.position} left with ADP inside the next ${teamCount} picks.`}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-[15px] font-bold text-white">No run</p>
            <p className="mt-0.5 text-[11px] text-white/60">Recent picks are spread across positions.</p>
          </>
        )}
      </div>

      <div className="min-w-0 flex-[1_1_200px] rounded-lg border border-white/8 bg-[#0d1524]/90 px-2.5 py-2" data-testid="draft-pulse-value">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Your picks vs ADP</p>
        <p className={`mt-1 text-[18px] font-bold ${deltaTone(value.viewerTotal)}`}>
          {value.viewerTotal == null ? '—' : formatAdpDelta(value.viewerTotal)}
        </p>
        {value.biggestSteal ? (
          <p className="truncate text-[11px] text-white/70">
            Steal: {value.biggestSteal.playerName} {formatAdpDelta(value.biggestSteal.delta)}
            {value.biggestSteal.displayName ? ` · ${value.biggestSteal.displayName}` : ''}
          </p>
        ) : null}
        {value.biggestReach ? (
          <p className="truncate text-[11px] text-white/70">
            Reach: {value.biggestReach.playerName} {formatAdpDelta(value.biggestReach.delta)}
            {value.biggestReach.displayName ? ` · ${value.biggestReach.displayName}` : ''}
          </p>
        ) : null}
      </div>
    </section>
  )
}

export const DraftPulseStrip = React.memo(DraftPulseStripInner)
