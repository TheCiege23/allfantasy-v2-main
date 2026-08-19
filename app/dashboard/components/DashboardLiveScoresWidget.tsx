'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import type { DashboardLiveScore } from '@/lib/types/liveScoring'
import type { UserLeague } from '@/app/dashboard/types'

function ordinal(n: number): string {
  if (n <= 0) return String(n)
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function ScoreRow({ score }: { score: DashboardLiveScore }) {
  const [ptFlash, setPtFlash] = useState(false)
  const prevPts = useRef<number | null>(null)

  useEffect(() => {
    if (prevPts.current != null && score.myPts !== prevPts.current) {
      setPtFlash(true)
      const t = setTimeout(() => setPtFlash(false), 900)
      return () => clearTimeout(t)
    }
    prevPts.current = score.myPts
  }, [score.myPts])

  const isLive = score.matchupStatus === 'in_progress'
  const myWinning = score.oppPts != null && score.myPts > score.oppPts
  const oppWinning = score.oppPts != null && score.myPts < score.oppPts
  const myRecord = `${score.myRecord.wins}-${score.myRecord.losses}${score.myRecord.ties > 0 ? `-${score.myRecord.ties}` : ''}`

  return (
    <Link
      href={`/league/${encodeURIComponent(score.leagueId)}`}
      className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#121826] px-3 py-2.5 transition hover:border-white/[0.12] hover:bg-[#16202e]"
      data-testid={`live-score-row-${score.leagueId}`}
    >
      {/* Live indicator */}
      <div className="flex w-8 shrink-0 flex-col items-center gap-0.5">
        {isLive ? (
          <>
            <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.5)]" aria-label="Live" />
            <span className="text-[8px] font-bold uppercase tracking-widest text-green-400/80">Live</span>
          </>
        ) : (
          <span className="h-2 w-2 rounded-full bg-white/20" aria-hidden />
        )}
      </div>

      {/* League name + record */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold text-white/90">{score.leagueName}</p>
        <p className="text-[10px] text-white/45">
          {myRecord} · {ordinal(score.myRank ?? score.totalTeams)}/{score.totalTeams}
        </p>
      </div>

      {/* Matchup score */}
      <div className="shrink-0 text-right">
        <div className="flex items-baseline gap-1">
          <span
            className={`text-[14px] font-bold tabular-nums transition-colors duration-700 ${ptFlash ? 'text-cyan-300' : myWinning ? 'text-cyan-200' : oppWinning ? 'text-white/60' : 'text-white/85'}`}
            data-testid="dash-live-my-pts"
          >
            {score.myPts.toFixed(1)}
          </span>
          {score.oppPts != null ? (
            <>
              <span className="text-[11px] text-white/30">–</span>
              <span className="text-[12px] tabular-nums text-white/45">{score.oppPts.toFixed(1)}</span>
            </>
          ) : null}
        </div>
        {score.oppTeamName ? (
          <p className="text-[10px] text-white/35">vs {score.oppTeamName}</p>
        ) : null}
      </div>

      {/* Win/loss trend icon */}
      <div className="shrink-0">
        {myWinning ? (
          <TrendingUp className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
        ) : oppWinning ? (
          <TrendingDown className="h-3.5 w-3.5 text-rose-400" aria-hidden />
        ) : (
          <Minus className="h-3.5 w-3.5 text-white/25" aria-hidden />
        )}
      </div>
    </Link>
  )
}

export function DashboardLiveScoresWidget({ leagues }: { leagues: UserLeague[] }) {
  const [scores, setScores] = useState<DashboardLiveScore[]>([])
  const [loaded, setLoaded] = useState(false)

  const loadScores = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/live-scores', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { scores?: DashboardLiveScore[] }
      setScores(data.scores ?? [])
    } catch {
      // best-effort — non-fatal
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadScores()
  }, [loadScores])

  // Subscribe to SSE for the primary (first) active redraft league to get score updates.
  const primaryLeagueId = scores[0]?.leagueId ?? leagues.find((l) => l.leagueType === 'redraft' || l.leagueType == null)?.id
  useLeagueRealtimeRefresh(primaryLeagueId, (env) => {
    const t = String(env.eventType ?? '')
    if (t.includes('score') || t.includes('matchup') || t === 'player_changed' || t === 'league_changed') {
      void loadScores()
    }
  })

  if (!loaded) {
    return (
      <div className="mb-4 space-y-2" aria-hidden>
        <div className="h-4 w-32 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
        <div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" />
      </div>
    )
  }

  if (scores.length === 0) return null

  const anyLive = scores.some((s) => s.matchupStatus === 'in_progress')

  return (
    <section className="mb-4 space-y-2" data-testid="dashboard-live-scores">
      <div className="flex items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          Week {scores[0]?.week} scores
        </h3>
        {anyLive && (
          <span className="inline-flex items-center gap-1 rounded-full border border-green-400/25 bg-green-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-300">
            <Zap className="h-2.5 w-2.5" aria-hidden />
            Live
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {scores.slice(0, 5).map((s) => (
          <ScoreRow key={s.leagueId} score={s} />
        ))}
      </div>
    </section>
  )
}
