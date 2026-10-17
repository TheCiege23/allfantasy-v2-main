"use client"

import Link from "next/link"
import type { MatchupSummary } from "./MatchupCard"
import { MatchupSimulationCard } from "@/components/simulation/MatchupSimulationCard"
import { MatchupDramaWidget } from "@/components/app/matchups/MatchupDramaWidget"

type MatchupDetailViewProps = {
  leagueId: string
  sport?: string
  selectedWeekOrRound?: number
  matchup: MatchupSummary | null
}

export function MatchupDetailView({
  leagueId,
  sport,
  selectedWeekOrRound,
  matchup,
}: MatchupDetailViewProps) {
  if (!matchup) {
    return (
      <section className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
        Select a matchup to see full lineups and live scoring details.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/80">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <div>
          <p data-testid="matchup-detail-title" className="text-sm font-semibold text-white">
            {matchup.teamA} <span className="text-white/45">vs</span> {matchup.teamB}
          </p>
          <p className="mt-0.5 text-[11px] text-white/65">
            {matchup.scoreA.toFixed(1)} – {matchup.scoreB.toFixed(1)} now •{" "}
            {matchup.projA.toFixed(1)} – {matchup.projB.toFixed(1)} projected
          </p>
        </div>
        <div className="text-right text-[11px]">
          <p className="text-white/60">Win prob</p>
          <p className="font-semibold text-emerald-300">
            {(matchup.winProbA * 100).toFixed(0)}% {matchup.teamA}
          </p>
          <p className="mt-0.5 text-white/55">
            Remaining: {matchup.remainingA} vs {matchup.remainingB}
          </p>
        </div>
      </header>
      <div className="mt-2 flex justify-end">
        <Link
          href={`/league/${leagueId}?tab=Settings`}
          data-testid="matchup-scoring-settings-link"
          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
        >
          Review scoring settings
        </Link>
      </div>

      <div className="mt-3">
        <MatchupSimulationCard
          teamAName={matchup.teamA}
          teamBName={matchup.teamB}
          sport={sport ?? matchup.sport ?? 'NFL'}
          leagueId={leagueId}
          weekOrPeriod={selectedWeekOrRound ?? matchup.weekOrRound ?? 1}
          teamAId={matchup.teamAId}
          teamBId={matchup.teamBId}
          persist={Boolean(leagueId && matchup.teamAId && matchup.teamBId)}
          teamA={{ mean: Math.max(matchup.scoreA, matchup.projA), stdDev: 12 }}
          teamB={{ mean: Math.max(matchup.scoreB, matchup.projB), stdDev: 12 }}
          scoreA={matchup.scoreA}
          scoreB={matchup.scoreB}
        />
      </div>
      <div className="mt-3">
        <MatchupDramaWidget
          leagueId={leagueId}
          matchupId={matchup.id}
          teamAId={matchup.teamAId}
          teamBId={matchup.teamBId}
          sport={sport ?? matchup.sport}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <ScoreDetailColumn
          title={matchup.teamA}
          current={matchup.scoreA}
          projected={matchup.projA}
          winProbability={matchup.winProbA}
          remaining={matchup.remainingA}
        />
        <ScoreDetailColumn
          title={matchup.teamB}
          current={matchup.scoreB}
          projected={matchup.projB}
          winProbability={1 - matchup.winProbA}
          remaining={matchup.remainingB}
        />
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-2.5 text-[11px] text-white/65">
        Lineup-level player boxes are populated when period stats are available for both teams.
        Scoring and projection totals above stay live as matchup facts update.
      </div>
    </section>
  )
}

function ScoreDetailColumn({
  title,
  current,
  projected,
  winProbability,
  remaining,
}: {
  title: string
  current: number
  projected: number
  winProbability: number
  remaining: number
}) {
  return (
    <div className="rounded-xl border border-white/15 bg-black/50 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-white/70">
        <span className="truncate font-semibold">{title}</span>
      </div>
      <div className="space-y-1 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-white/50">Current</span>
          <span className="font-medium text-emerald-200">{current.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50">Projected</span>
          <span className="font-medium text-white/85">{projected.toFixed(1)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50">Win probability</span>
          <span className="font-medium text-cyan-200">{(winProbability * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/50">Remaining players</span>
          <span className="font-medium text-white/75">{Math.max(0, Math.floor(remaining))}</span>
        </div>
      </div>
    </div>
  )
}

