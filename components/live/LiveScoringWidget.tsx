"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Activity, Radio, TrendingUp } from "lucide-react"

type LiveMatchupState = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homeProj: number
  awayProj: number
  winProbHome: number
  remainingHome: number
  remainingAway: number
  status: string
}

export default function LiveScoringWidget({ leagueId }: { leagueId?: string }) {
  const [matchup, setMatchup] = useState<LiveMatchupState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function fetchScores(refresh = false) {
      try {
        setLoading(true)
        setError(null)
        let leagueSport: string | null = null
        if (leagueId) {
          const matchupsRes = await fetch(
            `/api/leagues/${encodeURIComponent(leagueId)}/matchups`,
            { cache: 'no-store' }
          )
          if (matchupsRes.ok) {
            const matchupJson = await matchupsRes.json().catch(() => null)
            leagueSport =
              typeof matchupJson?.sport === 'string' ? matchupJson.sport : null
            const rows = Array.isArray(matchupJson?.matchups) ? matchupJson.matchups : []
            if (!mounted) return
            if (rows.length > 0) {
              const m = rows[0]
              setMatchup({
                homeTeam: m.teamAName ?? 'Team A',
                awayTeam: m.teamBName ?? 'Team B',
                homeScore: Number(m.scoreA ?? 0),
                awayScore: Number(m.scoreB ?? 0),
                homeProj: Number(m.projA ?? 0),
                awayProj: Number(m.projB ?? 0),
                winProbHome: Number(m.winProbA ?? 0.5),
                remainingHome: Number(m.remainingA ?? 0),
                remainingAway: Number(m.remainingB ?? 0),
                status: `${matchupJson?.label ?? 'Week'} ${matchupJson?.selectedWeekOrRound ?? ''}`.trim(),
              })
              return
            }
          }
        }
        const qs = new URLSearchParams()
        if (refresh) qs.set('refresh', 'true')
        if (leagueSport) qs.set('sport', leagueSport)
        const url = `/api/sports/live-scores${qs.toString() ? `?${qs.toString()}` : ''}`
        const res = await fetch(url, { cache: "no-store" })
        if (!res.ok) {
          throw new Error("Live scores unavailable")
        }
        const json = await res.json()
        const scores = Array.isArray(json?.scores) ? json.scores : []
        if (!mounted) return

        if (!scores.length) {
          setMatchup(null)
          return
        }

        const live = scores.find(
          (s: any) =>
            s.status === "STATUS_IN_PROGRESS" ||
            s.status === "STATUS_HALFTIME" ||
            String(s.statusDetail || "").toLowerCase().includes("q"),
        )
        const game = live || scores[0]

        const homeScore = Number(game.homeScore || 0)
        const awayScore = Number(game.awayScore || 0)
        const winProbHome =
          1 / (1 + Math.exp(((awayScore || 0) - (homeScore || 0)) / 8))

        setMatchup({
          homeTeam: game.homeTeamFull || game.homeTeam,
          awayTeam: game.awayTeamFull || game.awayTeam,
          homeScore,
          awayScore,
          homeProj: homeScore + 20, // placeholder projection logic
          awayProj: awayScore + 20,
          winProbHome,
          remainingHome: 0,
          remainingAway: 0,
          status: game.statusDetail || "Scheduled",
        })
      } catch (err: any) {
        if (!mounted) return
        setError(err?.message || "Unable to load live scores.")
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void fetchScores(false)

    const interval = setInterval(() => {
      if (!mounted) return
      void fetchScores(false)
    }, 60000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [leagueId])

  if (!matchup && loading) {
    return null
  }

  if (!matchup && error) {
    return null
  }

  const linkHref = leagueId ? `/league/${leagueId}?tab=Matchups` : "/leagues"

  return (
    <section className="rounded-2xl border border-cyan-400/35 bg-gradient-to-r from-cyan-500/15 via-cyan-500/5 to-transparent p-3 text-xs shadow-[0_12px_30px_rgba(8,47,73,0.7)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-400/60 bg-black/60">
            <Radio className="h-3.5 w-3.5 text-cyan-300" />
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold">Live Matchup</p>
            <p className="text-[11px] text-cyan-100/80">
              Live scoring and matchup projections.
            </p>
          </div>
        </div>
        <Link
          href={linkHref}
          className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100 hover:bg-cyan-500/20"
        >
          Open league
        </Link>
      </div>

      <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="rounded-xl border border-white/10 bg-black/50 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-white">
                {matchup?.homeTeam || "Home team"}
              </p>
              <p className="text-[11px] text-white/60">{matchup?.awayTeam || "Away team"}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold text-white">
                {matchup ? matchup.homeScore.toFixed(1) : "-"}{" "}
                <span className="text-white/50">–</span>{" "}
                {matchup ? matchup.awayScore.toFixed(1) : "-"}
              </p>
              <p className="text-[11px] text-cyan-100/80">
                {matchup ? matchup.homeProj.toFixed(1) : "-"} –{" "}
                {matchup ? matchup.awayProj.toFixed(1) : "-"} proj
              </p>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-white/55">
            {matchup?.status || "No live games"}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-white/10 bg-black/50 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-[11px] text-white/70">Win probability</span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-300">
              {matchup ? (matchup.winProbHome * 100).toFixed(0) : "–"}% you
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-white/10">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-cyan-300"
              style={{
                width: `${
                  matchup
                    ? Math.max(4, Math.min(96, matchup.winProbHome * 100))
                    : 4
                }%`,
              }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/55">
            <span>
              Remaining players: {matchup?.remainingHome ?? 0} vs {matchup?.remainingAway ?? 0}
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-200">
              <Activity className="h-3 w-3" />
              Live
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

