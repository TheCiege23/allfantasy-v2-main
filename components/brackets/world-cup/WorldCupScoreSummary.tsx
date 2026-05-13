"use client"

import { AlertTriangle, CheckCircle2, Crown, Lock, Medal, Target, Trophy, XCircle } from "lucide-react"
import type { WorldCupLeaderboardRow } from "@/lib/world-cup/types"
import type { WorldCupBracketEntryClient } from "@/lib/world-cup/worldCupClientApi"
import { getWorldCupPossiblePointsRemaining } from "@/lib/world-cup/worldCupLeaderboardService"

export default function WorldCupScoreSummary({
  entry,
  leaderboardRow,
  championStillAlive,
  isLocked,
  fixturesReady,
  scoresSynced,
}: {
  entry: WorldCupBracketEntryClient
  leaderboardRow?: WorldCupLeaderboardRow | null
  /** Prefer leaderboard truth; fallback computed in shell when row missing */
  championStillAlive: boolean
  isLocked: boolean
  /** Challenge has resolvable pickable matchups */
  fixturesReady: boolean
  /** Results have been synced at least once (lastSyncedAt present) */
  scoresSynced: boolean
}) {
  const totalScore = leaderboardRow?.totalScore ?? entry.totalScore
  const maxPossible = leaderboardRow?.maxPossibleScore ?? entry.maxPossibleScore
  const correct = leaderboardRow?.correctPicks ?? entry.correctPicks
  const incorrect = leaderboardRow?.incorrectPicks ?? entry.incorrectPicks
  const rank = leaderboardRow?.rank ?? entry.rank
  const championName =
    leaderboardRow?.championPickName ?? entry.championTeamName ?? null

  const possibleRemaining = getWorldCupPossiblePointsRemaining(totalScore, maxPossible)
  const complete = entry.isComplete

  return (
    <section
      data-testid="world-cup-score-summary"
      className="mx-3 mb-3 rounded-2xl border border-white/12 bg-gradient-to-br from-[#0a1228]/95 to-black/40 p-3 shadow-lg shadow-black/40 sm:mx-4 sm:mb-4 sm:p-4"
    >
      <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40 sm:text-[10px]">
            Bracket scorecard
          </p>
          <p className="truncate text-sm font-black text-white">{entry.name}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {rank != null ? (
            <span
              data-testid="wc-summary-rank"
              className="inline-flex items-center gap-1 rounded-full bg-cyan-400/15 px-2.5 py-1 text-xs font-black text-cyan-200"
            >
              <Medal className="h-3.5 w-3.5" /> #{rank}
            </span>
          ) : (
            <span className="text-[11px] font-bold text-white/35">Rank —</span>
          )}
          <span
            data-testid="wc-summary-completion"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              complete ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/15 text-amber-200"
            }`}
          >
            <Target className="h-3 w-3" />
            {complete ? "Bracket complete" : "Bracket incomplete"}
          </span>
        </div>
      </div>

      {/* Status banners */}
      {!fixturesReady && (
        <div
          data-testid="wc-summary-fixtures-not-ready"
          className="mb-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Fixtures are not fully resolved yet — scoring updates once matchups are official.</span>
        </div>
      )}
      {fixturesReady && !scoresSynced && (
        <div
          data-testid="wc-summary-scores-not-synced"
          className="mb-3 flex items-start gap-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Scores have not synced yet — points appear after results post.</span>
        </div>
      )}
      {isLocked && (
        <div
          data-testid="wc-summary-locked"
          className="mb-3 flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100"
        >
          <Lock className="h-4 w-4 shrink-0" />
          Bracket locked — picks are frozen.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/30 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="text-[8px] font-bold uppercase tracking-wide text-white/40 sm:text-[9px]">Total pts</div>
          <div data-testid="wc-summary-total-points" className="mt-0.5 text-xl font-black tabular-nums text-cyan-100 sm:mt-1 sm:text-2xl">
            {totalScore}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/30 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="text-[8px] font-bold uppercase tracking-wide text-white/40 sm:text-[9px]">Possible left</div>
          <div
            data-testid="wc-summary-possible-remaining"
            className="mt-0.5 text-xl font-black tabular-nums text-cyan-200 sm:mt-1 sm:text-2xl"
          >
            {possibleRemaining}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/30 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="text-[8px] font-bold uppercase tracking-wide text-white/40 sm:text-[9px]">Correct</div>
          <div
            data-testid="wc-summary-correct-picks"
            className="mt-0.5 flex items-center gap-1 text-xl font-black tabular-nums text-emerald-300 sm:mt-1 sm:text-2xl"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 opacity-80 sm:h-5 sm:w-5" />
            {correct}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/30 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="text-[8px] font-bold uppercase tracking-wide text-white/40 sm:text-[9px]">Wrong</div>
          <div
            data-testid="wc-summary-wrong-picks"
            className="mt-0.5 flex items-center gap-1 text-xl font-black tabular-nums text-rose-300 sm:mt-1 sm:text-2xl"
          >
            <XCircle className="h-4 w-4 shrink-0 opacity-80 sm:h-5 sm:w-5" />
            {incorrect}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="mb-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-white/45 sm:mb-1 sm:text-[10px]">
            <Trophy className="h-3 w-3 shrink-0 text-amber-300/90 sm:h-3.5 sm:w-3.5" />
            Champion pick
          </div>
          <div className="truncate text-sm font-black text-white">{championName ?? "—"}</div>
          {championName ? (
            <div
              data-testid="wc-summary-champion-status"
              className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold transition-colors duration-300 sm:mt-2 sm:text-[10px] ${
                championStillAlive
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-rose-500/20 text-rose-200"
              }`}
            >
              <Crown className="h-3 w-3" />
              {championStillAlive ? "Champion alive" : "Champion busted"}
            </div>
          ) : (
            <p className="mt-0.5 text-[10px] text-white/35 sm:mt-1 sm:text-[11px]">No champion selected yet</p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wide text-white/45 sm:mb-1 sm:text-[10px]">
            Max ceiling
          </div>
          <p className="text-xs leading-snug text-white/70 sm:text-sm">
            <span className="font-black text-white">{maxPossible}</span>
            <span className="text-white/45"> possible pts tracked for your remaining paths</span>
          </p>
        </div>
      </div>
    </section>
  )
}
