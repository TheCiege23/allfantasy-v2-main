'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import type { MatchupCenterPayload, MatchupSidePayload } from '@/lib/matchup-center/types'
import { computeMatchupWinProbability } from '@/lib/matchup-center/winProbability'

type BannerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: MatchupCenterPayload }
  | { status: 'empty' }

/** Neon red for "AF projects you to lose" (owner's call, 2026-11-17). */
const LOSING_RED = '#ff2d55'

/**
 * AF's win chance, from AF's own totals, under the SAME honesty gate as the provider's
 * (computeMatchupWinProbability): a side whose AF total misses any starter counts as built on a
 * fallback, so the answer is null rather than a percentage that looks measured.
 */
export function afWinProbability(left: MatchupSidePayload, right: MatchupSidePayload): number | null {
  if (left.afProjectedTotal == null || right.afProjectedTotal == null) return null
  return computeMatchupWinProbability(
    { projectedTotal: left.afProjectedTotal, projectedTotalIncludesFallback: (left.afProjectedFrom ?? 0) < left.starters.length },
    { projectedTotal: right.afProjectedTotal, projectedTotalIncludesFallback: (right.afProjectedFrom ?? 0) < right.starters.length },
  )
}

/** "2 QB, 2 RB, WR, TE" — the starters whose games are not final, grouped by position. */
export function yetToPlayPositions(side: MatchupSidePayload): string {
  const counts = new Map<string, number>()
  for (const s of side.starters) {
    if (s.gameStatus === 'final') continue
    const pos = (s.position || '?').toUpperCase()
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }
  return [...counts.entries()].map(([pos, n]) => (n > 1 ? `${n} ${pos}` : pos)).join(', ')
}

function Bar({ pct, color, glow }: { pct: number; color: string; glow?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--lsk-surface2, rgba(255,255,255,.1))' }}>
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${pct}%`, background: color, boxShadow: glow ? '0 0 12px rgba(255,45,85,.65)' : undefined }}
      />
    </div>
  )
}

export function TeamTabMatchupBanner({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<BannerState>({ status: 'idle' })

  useEffect(() => {
    setState({ status: 'loading' })
    let cancelled = false
    fetch(`/api/leagues/${leagueId}/matchup-center`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { payload?: MatchupCenterPayload } | null) => {
        if (cancelled) return
        const payload = json?.payload
        if (!payload?.week || !payload.left || !payload.right) {
          setState({ status: 'empty' })
          return
        }
        setState({ status: 'ready', data: payload })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'empty' })
      })
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (state.status === 'idle' || state.status === 'empty') return null

  if (state.status === 'loading') {
    return <Skeleton className="mb-3 h-28 w-full rounded-2xl" />
  }

  const { data } = state
  const you = data.left
  const them = data.right
  const winPct = data.winProbabilityLeft != null ? Math.round(data.winProbabilityLeft * 100) : null
  const afProb = afWinProbability(you, them)
  const afPct = afProb != null ? Math.round(afProb * 100) : null
  const afLosing = afPct != null && afPct < 50
  const ytp = yetToPlayPositions(you)

  return (
    <Link
      href="?tab=matchups"
      className="mb-3 block w-full rounded-2xl border px-4 py-4 text-left no-underline transition hover:brightness-110"
      style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.12))', background: 'var(--lsk-surface, #0a1228)', color: 'var(--lsk-text, #fff)' }}
      data-testid="team-tab-matchup-banner"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[16px] font-bold">{you.teamName}</span>
        <span className="text-[13px]" style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
          Week {data.week} vs <span className="font-semibold" style={{ color: 'var(--lsk-text2, #fff)' }}>{them.teamName}</span> ›
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 tabular-nums">
        <span className="text-[16px] font-extrabold" style={{ color: 'var(--lsk-accent, #3ddc84)' }}>
          {winPct != null ? `${winPct}% win` : 'Win % —'}
        </span>
        {winPct != null ? <Bar pct={winPct} color="var(--lsk-accent-strong, #3ddc84)" /> : <span />}
        <span className="text-[14px]" style={{ color: 'var(--lsk-muted, rgba(255,255,255,.6))' }}>
          proj. {you.projectedTotal.toFixed(1)}
        </span>

        {you.afProjectedTotal != null ? (
          <>
            <span className="text-[16px] font-extrabold" style={{ color: afLosing ? LOSING_RED : 'var(--af-blue, #3b82f6)' }} data-testid="team-banner-af-win">
              {afPct != null ? `AF ${afPct}% win` : 'AF'}
            </span>
            {afPct != null ? (
              <Bar pct={afPct} color={afLosing ? LOSING_RED : 'var(--af-blue, #3b82f6)'} glow={afLosing} />
            ) : (
              <span />
            )}
            <span className="af-proj-af text-[14px]">AF {you.afProjectedTotal.toFixed(1)}</span>
          </>
        ) : null}
      </div>

      {you.remainingStarters > 0 ? (
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--lsk-line, rgba(255,255,255,.08))' }}>
          <div className="text-[16px] font-extrabold">Yet to play ({you.remainingStarters})</div>
          {ytp ? <div className="mt-0.5 text-[15px]" style={{ color: 'var(--lsk-text2, rgba(255,255,255,.75))' }}>{ytp}</div> : null}
        </div>
      ) : null}
    </Link>
  )
}
