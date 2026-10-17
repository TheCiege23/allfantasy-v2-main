"use client"

import { useMemo, useRef, useEffect, useState } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  Crown,
  Loader2,
  Medal,
  Minus,
  RefreshCw,
  ShieldAlert,
  Star,
  Trophy,
  Users,
} from "lucide-react"
import Image from "next/image"
import type { WorldCupChallengeView } from "@/lib/world-cup/types"
import { WORLD_CUP_ROUND_LABELS } from "@/lib/world-cup/types"
import { calculateWorldCupLeaderboardAiInsights } from "@/lib/world-cup/worldCupAiSubscriptionInsights"
import {
  getWorldCupPossiblePointsRemaining,
  getWorldCupRankMovement,
} from "@/lib/world-cup/worldCupLeaderboardService"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import WorldCupShareCard from "./WorldCupShareCards"

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

// Premium podium card for rank 1 / 2 / 3
function PodiumCard({
  rank,
  displayName,
  entryName,
  totalScore,
  championPickName,
  isHighlighted,
}: {
  rank: number
  displayName: string
  entryName: string
  totalScore: number
  championPickName?: string | null
  isHighlighted: boolean
}) {
  const medalClass =
    rank === 1
      ? "border-amber-400/35 bg-gradient-to-br from-amber-300/[0.13] via-amber-500/[0.06] to-transparent"
      : rank === 2
      ? "border-white/20 bg-gradient-to-br from-white/[0.09] to-white/[0.03]"
      : "border-orange-400/25 bg-gradient-to-br from-orange-500/[0.10] to-orange-700/[0.04]"

  const rankIcon =
    rank === 1 ? (
      <Crown className="h-5 w-5 text-white/70" aria-hidden />
    ) : rank === 2 ? (
      <Medal className="h-5 w-5 text-white/70" aria-hidden />
    ) : (
      <Star className="h-5 w-5 text-orange-300/80" aria-hidden />
    )

  return (
    <div
      data-testid={`wc-lb-podium-${rank}`}
      className={`relative overflow-hidden rounded-xl border p-3 ${medalClass} ${isHighlighted ? "ring-2 ring-cyan-300/40" : ""}`}
    >
      {rank === 1 && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(251,191,36,0.08)_0%,transparent_65%)]" />
      )}
      <div className="relative flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/30">
          {rankIcon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{displayName}</div>
          <div className="truncate text-[11px] text-white/45">{entryName}</div>
          {championPickName && (
            <div className="mt-1 truncate text-[11px] text-white/35">
              <Trophy className="mr-1 inline h-2.5 w-2.5" />{championPickName}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-black tabular-nums text-white">{totalScore}</div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-white/40">pts</div>
        </div>
      </div>
    </div>
  )
}

export default function WorldCupLeaderboard({
  view,
  onRecalculate,
  busy,
  switchTab,
}: {
  view: WorldCupChallengeView
  onRecalculate?: () => void
  busy?: boolean
  switchTab?: (tab: string) => void
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

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
  const fixturesReady = view.matches.some((m) => m.homeTeamId && m.awayTeamId)
  const aiInsightsByEntry = new Map(
    calculateWorldCupLeaderboardAiInsights(view.leaderboard).map((insight) => [insight.entryId, insight])
  )

  // Status badge
  const statusKey = !fixturesReady
    ? "wc.lb.statusWaiting"
    : !scoresSynced
    ? "wc.lb.statusPreTournament"
    : "wc.lb.statusLive"

  const statusColors = {
    "wc.lb.statusWaiting": "border-amber-400/20 bg-amber-500/10 text-white/70",
    "wc.lb.statusPreTournament": "border-sky-400/20 bg-sky-500/10 text-white/75",
    "wc.lb.statusLive": "border-emerald-400/25 bg-emerald-500/10 text-white/80",
  } as const

  // User's leaderboard row (if finalized)
  const userLeaderboardRow = highlightEntryId
    ? view.leaderboard.find((r) => r.entryId === highlightEntryId) ?? null
    : null

  // Leader row
  const sorted = [...view.leaderboard].sort((a, b) => a.rank - b.rank)
  const top3 = sorted.slice(0, 3)
  const leaderScore = sorted[0]?.totalScore ?? 0

  // Gap to first
  const gapToFirst = userLeaderboardRow
    ? Math.max(0, leaderScore - userLeaderboardRow.totalScore)
    : null

  // Last synced formatted date
  const lastSyncedLabel = view.challenge.lastSyncedAt
    ? new Date(view.challenge.lastSyncedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null

  return (
    <div
      data-testid="world-cup-leaderboard"
      className="relative mx-auto max-w-4xl px-4 py-5 pb-28 sm:pb-8"
    >
      {busy && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-black/20 pt-24">
          <Loader2 className="h-8 w-8 animate-spin text-white/65" aria-hidden />
        </div>
      )}

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section
        data-testid="wc-leaderboard-hero"
        className="mb-4 overflow-hidden rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.07] via-indigo-500/[0.04] to-transparent p-5 sm:p-6"
      >
        {/* atmospheric glow */}
        <div className="pointer-events-none absolute -left-12 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" aria-hidden />

        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10">
              <Trophy className="h-5 w-5 text-white/85" aria-hidden />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
                  {t("wc.lb.eyebrow")}
                </p>
                <span
                  data-testid="wc-lb-status-badge"
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusColors[statusKey as keyof typeof statusColors] ?? "border-white/15 bg-white/[0.04] text-white/60"}`}
                >
                  {t(statusKey)}
                </span>
              </div>
              <h2 className="mt-0.5 text-xl font-black text-white">{t("wc.lb.title")}</h2>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-white/55">
                {t("wc.lb.heroSubtitle")}
              </p>
              <p className="mt-1.5 text-[11px] text-white/40">
                {t("wc.lb.subtitleBase")}{" "}
                {lastSyncedLabel
                  ? t("wc.lb.lastUpdated", { date: lastSyncedLabel })
                  : t("wc.lb.notYetSynced")}
              </p>
            </div>
          </div>

          {/* Recalculate / auto-update */}
          <div className="flex shrink-0 items-center gap-2">
            {view.isAdmin ? (
              <button
                type="button"
                onClick={onRecalculate}
                disabled={busy}
                data-testid="world-cup-leaderboard-recalculate"
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/75 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                {t("wc.lb.recalculate")}
              </button>
            ) : (
              <span
                data-testid="world-cup-leaderboard-auto-update"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-semibold text-white/55"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                {t("wc.lb.autoUpdate")}
              </span>
            )}
          </div>
        </div>

        {/* Test mode badge */}
        {(view.challenge.isTestMode || (view.challenge as any).simulationEnabled || (view.challenge as any).hasSimulatedResults) && (
          <p className="mt-3 text-xs font-semibold text-white/75">{t("wc.lb.testMode")}</p>
        )}
      </section>

      {/* ── Status banners ─────────────────────────────────────────────── */}
      {!scoresSynced && (
        <div
          data-testid="wc-leaderboard-scores-not-synced"
          className="mb-4 flex items-start gap-2 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[11px] text-white/80"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t("wc.lb.scoresNotSynced")}
        </div>
      )}

      {!fixturesReady && (
        <div
          data-testid="wc-leaderboard-fixtures-not-ready"
          className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-white/80"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t("wc.lb.fixturesNotReady")}
        </div>
      )}

      {/* ── Your Rank card ─────────────────────────────────────────────── */}
      {highlightEntryId && userLeaderboardRow ? (
        <section
          data-testid="wc-lb-your-rank-card"
          className="mb-4 overflow-hidden rounded-2xl border border-cyan-300/40 bg-gradient-to-r from-cyan-300/[0.10] to-cyan-300/[0.04] p-4 shadow-[0_0_24px_-8px_rgba(34,211,238,0.25)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/50">
                {t("wc.lb.yourRank")}
              </p>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-white">
                  #{userLeaderboardRow.rank}
                </span>
                <span className="text-sm font-bold text-white/60">
                  {userLeaderboardRow.totalScore} pts
                </span>
              </div>
              <p className="mt-0.5 text-xs text-white/55">
                {gapToFirst === 0
                  ? t("wc.lb.isLeader")
                  : gapToFirst != null && gapToFirst <= 5
                  ? t("wc.lb.tied")
                  : gapToFirst != null
                  ? t("wc.lb.gapToFirst", { n: gapToFirst })
                  : t("wc.lb.yourRankTagline")}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/40">
                {userLeaderboardRow.entryName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => switchTab?.("review")}
              data-testid="wc-lb-view-my-bracket"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-white/85 transition-colors hover:border-cyan-300/45 hover:bg-cyan-300/15 touch-manipulation"
            >
              {t("wc.lb.viewMyBracket")}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      ) : highlightEntryId && !userLeaderboardRow ? (
        // User has an entry but it is not yet on the leaderboard (not finalized)
        <section
          data-testid="wc-lb-no-rank-yet"
          className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] p-4"
        >
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/45">
            {t("wc.lb.yourRank")}
          </p>
          <p className="mt-1 text-sm font-black text-white/70">{t("wc.lb.noEntryTitle")}</p>
          <p className="mt-0.5 text-xs text-white/45">{t("wc.lb.noEntryBody")}</p>
          <button
            type="button"
            onClick={() => switchTab?.("review")}
            data-testid="wc-lb-go-review"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/80 touch-manipulation hover:border-white/25"
          >
            {t("wc.lb.viewMyBracket")}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </section>
      ) : !highlightEntryId && view.leaderboard.length > 0 ? (
        // Not a participant
        <section
          data-testid="wc-lb-join-cta"
          className="mb-4 rounded-2xl border border-white/15 bg-white/[0.04] p-4"
        >
          <p className="text-sm font-black text-white/70">{t("wc.lb.noEntryTitle")}</p>
          <p className="mt-0.5 text-xs text-white/45">{t("wc.lb.noEntryBody")}</p>
          <button
            type="button"
            onClick={() => switchTab?.("group-stage")}
            data-testid="wc-lb-start-bracket"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black touch-manipulation hover:bg-cyan-200"
          >
            {t("wc.lb.startMyBracket")}
          </button>
        </section>
      ) : null}

      {/* ── Share card (leaderboard) ────────────────────────────────────── */}
      <WorldCupShareCard
        kind="leaderboard"
        poolName={view.challenge.name}
        leaderboard={view.leaderboard}
        className="mb-4"
      />

      {/* ── Podium — top 3 ─────────────────────────────────────────────── */}
      {top3.length > 0 && (
        <section className="mb-4" data-testid="wc-lb-podium">
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
            {t("wc.lb.podiumTitle")}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {top3.map((row) => (
              <PodiumCard
                key={row.entryId}
                rank={row.rank}
                displayName={row.displayName}
                entryName={row.entryName}
                totalScore={row.totalScore}
                championPickName={row.championPickName}
                isHighlighted={row.entryId === highlightEntryId}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Scoring explainer ──────────────────────────────────────────── */}
      <details
        data-testid="wc-lb-scoring-explainer"
        className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black text-white/70">
          <span className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-white/60" aria-hidden />
            {t("wc.lb.scoringTitle")}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-white/30 transition-transform [[open]_&]:rotate-90" />
        </summary>
        <div className="mt-3 space-y-3">
          <p className="leading-5 text-white/60">{t("wc.lb.scoringBody")}</p>
          <ul className="space-y-1">
            {[
              { label: "Round of 32", pts: view.scoring.roundOf32Points },
              { label: "Round of 16", pts: view.scoring.roundOf16Points },
              { label: "Quarterfinal", pts: view.scoring.quarterFinalPoints },
              { label: "Semifinal", pts: view.scoring.semiFinalPoints },
              { label: "Final", pts: view.scoring.finalPoints },
            ].map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5"
              >
                <span className="text-white/55">{row.label}</span>
                <span className="font-black tabular-nums text-white">{row.pts} <span className="text-[11px] font-bold text-white/35">pts</span></span>
              </li>
            ))}
            <li className="flex items-center justify-between rounded-lg border border-amber-400/20 bg-amber-500/10 px-2.5 py-1.5">
              <span className="font-black text-white/80">Champion Bonus</span>
              <span className="font-black tabular-nums text-white">{view.scoring.championBonusPoints} <span className="text-[11px] font-bold text-white/35">pts</span></span>
            </li>
          </ul>
          <p className="text-[11px] text-white/40">{t("wc.lb.scoringUpdates")}</p>
        </div>
      </details>

      {/* ── Full list ──────────────────────────────────────────────────── */}
      {view.leaderboard.length === 0 ? (
        <div
          data-testid="wc-leaderboard-empty"
          className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] py-14 text-center backdrop-blur"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Trophy className="h-5 w-5 text-white/35" />
          </div>
          <div>
            <p className="text-sm font-black text-white/75">{t("wc.lb.emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/45">
              {t("wc.lb.emptyBody")}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 px-4">
            {switchTab && (
              <>
                <button
                  type="button"
                  onClick={() => switchTab("invite")}
                  data-testid="wc-lb-empty-invite"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.05] px-4 py-2 text-sm font-bold text-white/75 touch-manipulation hover:border-white/25"
                >
                  <Users className="h-3.5 w-3.5" />
                  {t("wc.lb.emptyInvite")}
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("review")}
                  data-testid="wc-lb-empty-review"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.06] px-4 py-2 text-sm font-bold text-white/75 touch-manipulation hover:border-cyan-300/40"
                >
                  {t("wc.lb.emptyReview")}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {view.leaderboard.map((row) => {
            const breakdown = Object.entries(row.roundBreakdown ?? {})
            const updatedLabel = row.updatedAt
              ? new Date(row.updatedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null
            const possibleLeft = getWorldCupPossiblePointsRemaining(row.totalScore, row.maxPossibleScore)
            const move = movementByEntry[row.entryId] ?? "unknown"
            const aiInsight = aiInsightsByEntry.get(row.entryId)

            return (
              <div
                key={row.entryId}
                data-testid={`wc-leaderboard-row-${row.entryId}`}
                data-mobile-card="true"
                className={`rounded-xl border p-3 transition-colors ${
                  highlightEntryId && row.entryId === highlightEntryId
                    ? "sticky bottom-20 z-10 border-cyan-300/45 bg-gradient-to-r from-cyan-300/[0.10] to-cyan-300/[0.04] shadow-[0_0_24px_-8px_rgba(34,211,238,0.35)] sm:static"
                    : "border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-black/30 text-sm font-black text-white">
                    {row.rank === 1 ? (
                      <Crown className="h-4 w-4 text-white/70" />
                    ) : row.rank === 2 ? (
                      <Medal className="h-4 w-4 text-white/65" />
                    ) : row.rank === 3 ? (
                      <Star className="h-4 w-4 text-orange-300/75" />
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
                          {row.championPickName ?? t("wc.lb.noChampionPick")}
                        </span>
                        {row.championPickName && (
                          <span
                            data-testid={`wc-lb-champion-status-${row.entryId}`}
                            className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                              row.championStillAlive
                                ? "bg-emerald-400/15 text-white/80"
                                : "bg-rose-400/15 text-white/80"
                            }`}
                          >
                            {row.championStillAlive ? t("wc.lb.alive") : t("wc.lb.busted")}
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
                            className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/35"
                          >
                            {(WORLD_CUP_ROUND_LABELS as Record<string, string>)[round] ?? round}: {pts}pts
                          </span>
                        ))}
                      </div>
                    )}

                    {view.hasBracketBrainAi && aiInsight ? (
                      <div
                        data-testid={`wc-lb-ai-health-${row.entryId}`}
                        className="mt-2 grid gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-2 text-[11px] text-white/70 sm:grid-cols-4"
                      >
                        <span><strong className="text-white">AI Win</strong> {aiInsight.aiWinProbability}%</span>
                        <span><strong className="text-white">Health</strong> {aiInsight.bracketHealth}</span>
                        <span><strong className="text-white">Max</strong> {aiInsight.maxPossiblePoints}</span>
                        <span><strong className="text-white">Champion</strong> {aiInsight.championAlive ? t("wc.lb.alive") : t("wc.lb.busted")}</span>
                      </div>
                    ) : !view.hasBracketBrainAi ? (
                      <div
                        data-testid={`wc-lb-ai-locked-${row.entryId}`}
                        className="mt-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] font-semibold text-white/45"
                      >
                        {t("wc.lb.aiProUnlocks")}
                      </div>
                    ) : null}

                    {updatedLabel && (
                      <div className="mt-1 text-[11px] text-white/20">
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
                        <span data-testid={`wc-lb-move-${row.entryId}`} className="text-white/85" title="Rank up">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "down" && (
                        <span data-testid={`wc-lb-move-${row.entryId}`} className="text-white/80" title="Rank down">
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
                      className="text-[11px] text-white/35"
                    >
                      possible left {possibleLeft}
                    </div>
                    <div className="text-[11px] text-white/25">max {row.maxPossibleScore}</div>
                  </div>
                  </div>

                  <div
                    data-testid="wc-lb-mobile-score-row"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 sm:hidden"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t("wc.lb.ptsLabel")}</span>
                      <span
                        data-testid={`wc-lb-total-mobile-${row.entryId}`}
                        className="text-lg font-black tabular-nums text-white"
                      >
                        {row.totalScore}
                      </span>
                      {move === "up" && (
                        <span className="text-white/85" title="Rank up">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "down" && (
                        <span className="text-white/80" title="Rank down">
                          <ArrowDownRight className="h-4 w-4" />
                        </span>
                      )}
                      {move === "same" && (
                        <span className="text-white/25" title="No change">
                          <Minus className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                    <div className="text-right text-[11px] text-white/40">
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

      {/* ── Trust / AI teaser footer ─────────────────────────────────────── */}
      <div className="mt-6 space-y-2">
        {!view.hasBracketBrainAi && (
          <div
            data-testid="wc-lb-ai-teaser"
            className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 py-3 text-xs text-white/55"
          >
            <p className="font-black text-white/70">{t("wc.home.ai.chimmyHint")}</p>
            <p className="mt-0.5">{t("wc.lb.aiProUnlocks")}</p>
          </div>
        )}
        <p
          data-testid="wc-lb-trust-note"
          className="text-center text-[11px] text-white/30"
        >
          {t("wc.lb.trustNote")}
        </p>
      </div>
    </div>
  )
}
