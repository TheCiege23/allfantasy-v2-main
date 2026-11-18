'use client'

import type { MatchupSidePayload } from '@/lib/matchup-center/types'

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

/**
 * One side of the head-to-head. Text is sized up from the old 11px (owner: "pretty small and hard
 * to read, even on PC"), and AF's own projection sits under the provider's in AF blue. Colours come
 * from the league type's skin (`--lsk-*`, components/league/league-type-skin.css) with fallbacks, so
 * the card still reads anywhere it is mounted without the skin.
 */
function Side({ side, align }: { side: MatchupSidePayload; align: 'left' | 'right' }) {
  const af = side.afProjectedTotal
  const partial = af != null && side.afProjectedFrom != null && side.afProjectedFrom < side.starters.length
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className="truncate text-[16px] font-bold" style={{ color: 'var(--lsk-text, #fff)' }}>
        {side.teamName}
      </div>
      <div className="mt-1 text-[34px] font-black leading-none tabular-nums" style={{ color: 'var(--lsk-text, #fff)' }}>
        {side.totalPoints.toFixed(2)}
      </div>
      <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[14px] tabular-nums ${align === 'right' ? 'justify-end' : ''}`}>
        <span style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>proj. {side.projectedTotal.toFixed(1)}</span>
        {af != null ? (
          <span className="af-proj-af" title={partial ? `AF projection for ${side.afProjectedFrom} of ${side.starters.length} starters` : 'AF projection'}>
            AF {af.toFixed(1)}
            {partial ? '*' : ''}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 text-[14px]" style={{ color: 'var(--lsk-text2, rgba(255,255,255,.75))' }}>
        {side.record.wins}-{side.record.losses}
        {side.record.ties ? `-${side.record.ties}` : ''} · {pct(side.winPct)}
      </div>
      <div className="mt-0.5 text-[14px]" style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
        {side.remainingStarters} left to play
      </div>
    </div>
  )
}

export function MatchupHeaderCard({
  left,
  right,
  matchupStatus,
  winProbabilityLeft,
  conceptOverlay,
}: {
  left: MatchupSidePayload
  right: MatchupSidePayload
  matchupStatus: string
  winProbabilityLeft: number | null
  conceptOverlay: string | null
}) {
  const statusLabel =
    matchupStatus === 'final' ? 'Final' : matchupStatus === 'live' ? 'Live' : 'Upcoming'
  const partialAf =
    (left.afProjectedTotal != null && (left.afProjectedFrom ?? 0) < left.starters.length) ||
    (right.afProjectedTotal != null && (right.afProjectedFrom ?? 0) < right.starters.length)

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
      style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.12))', background: 'var(--lsk-surface, #0a1228)' }}
    >
      {conceptOverlay ? (
        <div className="border-b border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-center text-[13px] font-medium text-amber-100/90">
          {conceptOverlay}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3 px-4 pt-5 pb-4">
        <Side side={left} align="left" />
        <div className="flex flex-col items-center justify-center px-1 pt-3">
          <span
            className="rounded-full border px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.12em]"
            style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.15))', color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}
          >
            {statusLabel}
          </span>
        </div>
        <Side side={right} align="right" />
      </div>
      {winProbabilityLeft != null ? (
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.06))' }}>
          <div className="mb-1.5 flex justify-between text-[13px]" style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
            <span>{pct(winProbabilityLeft)} win prob</span>
            <span>{pct(1 - winProbabilityLeft)} win prob</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--lsk-surface2, rgba(255,255,255,.1))' }}>
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${(winProbabilityLeft * 100).toFixed(1)}%`, background: 'var(--lsk-accent-strong, #ff3d81)' }}
              role="meter"
              aria-valuenow={Math.round(winProbabilityLeft * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${left.teamName} win probability`}
            />
          </div>
        </div>
      ) : (
        <div className="border-t px-4 py-3 text-[13px]" style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.06))', color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
          Win probability unavailable — real projections are missing for some starters.
        </div>
      )}
      {partialAf ? (
        <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
          * AF has projections for only some of this team&apos;s starters.
        </div>
      ) : null}
    </div>
  )
}
