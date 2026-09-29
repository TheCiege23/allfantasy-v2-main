"use client"

import { useMemo } from "react"
import { Target } from "lucide-react"
import type { WorldCupMatchView, WorldCupPickView, WorldCupScoringValues } from "@/lib/world-cup/types"
import { WORLD_CUP_ROUNDS } from "@/lib/world-cup/types"

const ROUND_POINTS_KEY: Record<string, keyof WorldCupScoringValues> = {
  round_of_32: "roundOf32Points",
  round_of_16: "roundOf16Points",
  quarterfinal: "quarterFinalPoints",
  semifinal: "semiFinalPoints",
  third_place: "thirdPlacePoints",
  final: "finalPoints",
}

function pointsForRound(round: string, scoring: WorldCupScoringValues): number {
  const key = ROUND_POINTS_KEY[round]
  if (!key) return 0
  const val = scoring[key]
  return typeof val === "number" ? val : 0
}

function roundOrder(round: string): number {
  const idx = (WORLD_CUP_ROUNDS as readonly string[]).indexOf(round)
  return idx >= 0 ? idx : -1
}

type MatchStake = {
  matchId: string
  label: string
  rootFor: string
  pointsAtStake: number
  round: string
}

export type WorldCupPersonalImpactStripProps = {
  picks: WorldCupPickView[]
  matches: WorldCupMatchView[]
  scoring: WorldCupScoringValues
  /** ISO string or null — defaults to now. Injected for tests. */
  now?: string | null
}

export default function WorldCupPersonalImpactStrip({
  picks,
  matches,
  scoring,
  now,
}: WorldCupPersonalImpactStripProps) {
  const stakes = useMemo<MatchStake[]>(() => {
    const cutoff = now ? new Date(now) : new Date()
    const upcoming = matches.filter(
      (m) =>
        (m.status === "scheduled" || m.status === "live" || m.status === "halftime") &&
        m.homeTeamId !== null &&
        m.awayTeamId !== null
    )

    const result: MatchStake[] = []
    for (const match of upcoming) {
      const pick = picks.find((p) => p.matchId === match.id)
      if (!pick?.selectedTeamId) continue

      const rootFor =
        pick.selectedTeamId === match.homeTeamId
          ? match.homeTeamName
          : pick.selectedTeamId === match.awayTeamId
            ? match.awayTeamName
            : null

      if (!rootFor) continue

      const pts = pointsForRound(match.round, scoring)
      if (pts <= 0) continue

      result.push({
        matchId: match.id,
        label: `${match.homeTeamName} vs ${match.awayTeamName}`,
        rootFor,
        pointsAtStake: pts,
        round: match.round,
      })
    }

    // Sort by round importance (finals first), then points desc
    result.sort((a, b) => roundOrder(b.round) - roundOrder(a.round) || b.pointsAtStake - a.pointsAtStake)

    return result.slice(0, 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, matches, scoring, now])

  if (stakes.length === 0) return null

  return (
    <section
      data-testid="world-cup-personal-impact-strip"
      className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
        <h3 className="text-sm font-black text-white">Why This Match Matters</h3>
      </div>

      <ul className="space-y-2" role="list">
        {stakes.map((stake) => (
          <li
            key={stake.matchId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
            data-testid="personal-impact-row"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white/90">{stake.label}</p>
              <p className="mt-0.5 text-[11px] text-white/50">
                Root for{" "}
                <span className="font-semibold text-white/75">{stake.rootFor}</span>
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/[0.08] px-2 py-0.5 text-[11px] font-black text-amber-200/90">
              {stake.pointsAtStake} pts at stake
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
