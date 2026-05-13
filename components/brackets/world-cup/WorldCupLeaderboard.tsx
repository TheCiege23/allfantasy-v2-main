"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Crown,
  Loader2,
  Medal,
  Minus,
  RefreshCw,
  ShieldAlert,
  Trophy,
} from "lucide-react"
import Image from "next/image"
import type { WorldCupChallengeView } from "@/lib/world-cup/types"
import { WORLD_CUP_ROUND_LABELS } from "@/lib/world-cup/types"
import {
  getWorldCupPossiblePointsRemaining,
  getWorldCupRankMovement,
} from "@/lib/world-cup/worldCupLeaderboardService"

function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <Image
        src={url}
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 rounded-lg object-cover"
      />
    )
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm font-black text-white/60">
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

export default function WorldCupLeaderboard({
  view,
  onRecalculate,
  busy,
}: {
  view: WorldCupChallengeView
  onRecalculate?: () => void
  busy?: boolean
}) {
  const highlightEntryId = view.activeEntry?.id ?? null
  const prevRanksRef = useRef<Map<string, number>>(new Map())
  const [movementByEntry, setMovementByEntry] = useState<
    Record<string, ReturnType<typeof getWorldCupRankMovement>>
  >({})

  useEffect(() => {
    const nextMove: Record<string, ReturnType<typeof getWorldCupRankMovement>> = {}
    const prev = prevRanksRef.current
    for (const row of view.leaderboard) {
      nextMove[row.entryId] = getWorldCupRankMovement(prev.get(row.entryId), row.rank)
    }
    setMovementByEntry(nextMove)
    prevRanksRef.current = new Map(view.leaderboard.map((r) => [r.entryId, r.rank]))
  }, [view.leaderboard])

  const scoresSynced = Boolean(view.challenge.lastSyncedAt)
  const isSimulated = Boolean(
    view.challenge.isTestMode || view.challenge.simulationEnabled || view.challenge.hasSimulatedResults
  )
  // Suppress "not synced" banner when: (a) this is a test/simulated pool where lastSyncedAt
  // is never set by design, or (b) the leaderboard already has scored entries (recalculate
  // was run and scores are live). Showing "not synced" alongside a leaderboard with real
  // scores is confusing.
  const hasAnyScore = view.leaderboard.some((r) => r.totalScore > 0)
  const showNotSyncedBanner = !scoresSynced && !isSimulated && !hasAnyScore
  const fixturesReady = view.matches.some((m) => m.homeTeamId && m.awayTeamId)

  return (
    <div
      data-testid="world-cup-leaderboard"
      className="relative mx-auto max-w-4xl px-4 py-5 pb-28 sm:pb-8"
    >
      {busy && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-black/20 pt-24">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-300/80" aria-hidden />
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Leaderboard</h2>
          <p className="text-xs text-white/45">
            Live standings — entries scored from finalized matches.
            {view.challenge.lastSyncedAt
              ? ` Last updated ${new Date(view.challenge.lastSyncedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
              : " Not yet synced."}
          </p>
          {(view.challenge.isTestMode || view.challenge.simulationEnabled || view.challenge.hasSimulatedResults) && (
            <p className="mt-1 text-xs text-amber-300">Test Mode: leaderboard may reflect simulated results.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!(view.isOwner || view.isAdmin) && (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-bold text-white/40 hover:text-white/60 disabled:opacity-30"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
          {(view.isOwner || view.isAdmin) && (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.97]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              Recalculate
            </button>
          )}
        </div>
      </div>

      {showNotSyncedBanner && (
        <div
          data-testid="wc-leaderboard-scores-not-synced"
          className="mb-4 flex items-start gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Scores have not synced yet — totals update after live score ingestion runs.
        </div>
      )}

      {!fixturesReady && (
        <div
          data-testid="wc-leaderboard-fixtures-not-ready"
          className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Fixtures not fully ready — teams must resolve before standings gain meaning.
        </div>
      )}

      {view.leaderboard.length === 0 ? (
        <div
          data-testid="wc-leaderboard-empty"
          className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] py-12 text-center"
        >
          <Trophy className="h-8 w-8 text-white/15" />
          <div>
            <p className="text-sm font-bold text-white/45">No leaderboard entries yet</p>
            <p className="mt-1 text-xs text-white/30">
              Join the challenge and submit a bracket — rankings appear once scoring begins.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {view.leaderboard.map((row) => {
            const breakdown = Object.entries(row.roundBreakdown ?? {})
            const updatedLabel = row.updatedAt
              ? new Date(row.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : null
            const possibleLeft = getWorldCupPossiblePointsRemaining(row.totalScore, row.maxPossibleScore)
            const move = movementByEntry[row.entryId] ?? "unknown"

            return (
              <div
                key={row.entryId}
                data-testid={`wc-leaderboard-row-${row.entryId}`}
                data-mobile-card="true"
                className={`rounded-lg border p-3 transition ${
                  highlightEntryId && row.entryId === highlightEntryId
                    ? "sticky bottom-20 z-10 border-cyan-300/40 bg-cyan-300/[0.07] sm:static"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/20"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-black/30 text-sm font-black text-white">
                    {row.rank === 1 ? (
                      <Crown className="h-4 w-4 text-amber-200" />
                    ) : row.rank <= 3 ? (
                      <Medal className="h-4 w-4 text-white/70" />
                    ) : (
                      row.rank
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Avatar name={row.displayName} url={row.avatarUrl} />
                      <div className="min-w-0">
                        <div
                          data-testid={`wc-lb-display-${row.entryId}`}
                          className="truncate text-sm font-black text-white"
                        >
                          {row.displayName}
                        </div>
                        <div
                          data-testid={`wc-lb-bracket-name-${row.entryId}`}
                          className="truncate text-[11px] text-white/40"
                        >
                          {row.entryName}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
                        <Trophy className="h-3 w-3" />
                        <span data-testid={`wc-lb-champion-${row.entryId}`}>
                          {row.championPickName ?? "No champion pick"}
                        </span>
                        {row.championPickName && (
                          <span
                            data-testid={`wc-lb-champion-status-${row.entryId}`}
                            className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                              row.championStillAlive
                                ? "bg-emerald-400/15 text-emerald-300"
                                : "bg-rose-400/15 text-rose-300"
                            }`}
                          >
                            {row.championStillAlive ? "Alive" : "Busted"}
                          </span>
                        )}
                      </span>
                      <span
                        data-testid={`wc-lb-picks-${row.entryId}`}
                        className="text-[11px] text-white/40"
                      >
                        ✓ {row.correctPicks} · ✗ {row.incorrectPicks}
                      </span>
                    </div>

                    {breakdown.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {breakdown.map(([round, pts]) => (
                          <span
                            key={round}
                            className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] text-white/35"
                          >
                            {(WORLD_CUP_ROUND_LABELS as Record<string, string>)[round] ?? round}: {pts}pts
                          </span>
                        ))}
                      </div>
                    )}

                    {updatedLabel && (
                      <div className="mt-1 text-[9px] text-white/20">
                        Updated {updatedLabel}
                      </div>
                    )}
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="flex items-center justify-end gap-1">
                      <div
                        data-testid={`wc-lb-total-${row.entryId}`}
                        className="text-xl font-black tabular-nums text-white"
                      >
                        {row.totalScore}
                      </div>
                      {move === "up" && (
                        <span data-testid={`wc-lb-move-${row.entryId}`} className="text-emerald-400" title="Rank up">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "down" && (
                        <span data-testid={`wc-lb-move-${row.entryId}`} className="text-rose-400" title="Rank down">
                          <ArrowDownRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "same" && (
                        <span className="text-white/25" title="No change">
                          <Minus className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                    <div
                      data-testid={`wc-lb-possible-${row.entryId}`}
                      className="text-[10px] text-white/35"
                    >
                      possible left {possibleLeft}
                    </div>
                    <div className="text-[10px] text-white/25">max {row.maxPossibleScore}</div>
                  </div>
                  </div>

                  <div
                    data-testid="wc-lb-mobile-score-row"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 sm:hidden"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-white/40">Pts</span>
                      <span
                        data-testid={`wc-lb-total-mobile-${row.entryId}`}
                        className="text-lg font-black tabular-nums text-white"
                      >
                        {row.totalScore}
                      </span>
                      {move === "up" && (
                        <span className="text-emerald-400" title="Rank up">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "down" && (
                        <span className="text-rose-400" title="Rank down">
                          <ArrowDownRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "same" && (
                        <span className="text-white/25" title="No change">
                          <Minus className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                    <div className="text-right text-[10px] text-white/40">
                      <span data-testid={`wc-lb-possible-mobile-${row.entryId}`}>left {possibleLeft}</span>
                      <span className="mx-1 text-white/20">·</span>
                      <span data-testid={`wc-lb-max-mobile-${row.entryId}`}>max {row.maxPossibleScore}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
