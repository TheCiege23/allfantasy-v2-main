'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

type BannerState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: MatchupCenterPayload }
  | { status: 'empty' }

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
    return <Skeleton className="mb-3 h-9 w-full rounded-lg" />
  }

  const { data } = state
  const userSide = data.left
  const opponentSide = data.right
  const userPts = Math.round(userSide.projectedTotal)
  const themPts = Math.round(opponentSide.projectedTotal)

  return (
    <Link
      href="?tab=matchups"
      className={cn(
        'mb-3 flex w-full items-center gap-2 rounded-lg border border-[#ff3d81]/20 bg-[#ff3d81]/[0.04] px-3 py-2 text-left transition hover:border-[#ff3d81]/35 hover:bg-[#ff3d81]/[0.07]',
      )}
      data-testid="team-tab-matchup-banner"
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff9ec0]/80">
        Week {data.week}
      </span>
      <span className="text-[11px] text-white/50">vs.</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/90">
        {opponentSide.teamName}
      </span>
      <span className="shrink-0 text-[11px] text-white/55">
        ~{userPts} – ~{themPts}
      </span>
      <span className="shrink-0 text-[10px] text-[#ff3d81]/70">›</span>
    </Link>
  )
}
