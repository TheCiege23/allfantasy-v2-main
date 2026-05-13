"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  RefreshCw, Trophy, Plus, Copy, Check, Settings2,
  ArrowRightCircle, ChevronDown, ChevronUp, Zap, RotateCcw,
  CheckCircle2, Circle, AlertCircle,
} from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"
import {
  createPlayoffBracketEntryClient,
  getPlayoffBracketViewClient,
} from "@/lib/playoffs/playoffClientApi"
import LiveSeriesTicker from "./LiveSeriesTicker"

type Props = {
  initialView: PlayoffChallengeView
}

// ─── Series resolve mini-panel ────────────────────────────────────────────────

function SeriesResolveRow({
  series,
  challengeId,
  onResolved,
}: {
  series: PlayoffSeriesView
  challengeId: string
  onResolved: () => void
}) {
  const [resolving, startResolving] = useTransition()

  async function resolve(winnerTeamName: string) {
    startResolving(async () => {
      try {
        const res = await fetch(
          `/api/brackets/playoffs/${challengeId}/series/${series.id}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ winnerTeamName }),
          }
        )
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error((data as any)?.error ?? "Resolve failed")
        }
        toast.success(`${winnerTeamName} wins S${series.seriesNumber}`)
        onResolved()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not resolve series")
      }
    })
  }

  const isFinal = series.status === "final"
  const isLive = series.status === "in_progress"
  const hasReal =
    !series.homeTeamName.startsWith("Winner") &&
    !series.homeTeamName.startsWith("East") &&
    !series.homeTeamName.startsWith("West") &&
    !series.homeTeamName.match(/^[A-Z]+\d$/)

  return (
    <li
      className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs ${
        isFinal
          ? "border-emerald-200 bg-emerald-50/30"
          : isLive
            ? "border-amber-300 bg-amber-50/40"
            : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-700">
          S{series.seriesNumber}
          {" "}
          <span className="font-normal text-slate-500">
            {series.homeTeamName} vs {series.awayTeamName}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {isFinal ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" />
              {series.winnerTeamName}
            </span>
          ) : isLive ? (
            <span className="text-amber-700 font-semibold">Live</span>
          ) : (
            <span className="text-slate-400">
              {series.homeWins}–{series.awayWins}
            </span>
          )}
        </div>
      </div>
      {!isFinal && hasReal && (
        <div className="flex gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => resolve(series.homeTeamName)}
            disabled={resolving}
            className="flex-1 rounded-md border border-emerald-400 bg-white px-2 py-1 text-center text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {series.homeTeamName} wins
          </button>
          <button
            type="button"
            onClick={() => resolve(series.awayTeamName)}
            disabled={resolving}
            className="flex-1 rounded-md border border-sky-400 bg-white px-2 py-1 text-center text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {series.awayTeamName} wins
          </button>
        </div>
      )}
      {!isFinal && !hasReal && (
        <p className="text-[10px] text-slate-400 italic">Placeholder — seed bracket to enable resolve</p>
      )}
    </li>
  )
}

// ─── Commissioner panel ────────────────────────────────────────────────────────

function CommissionerPanel({
  challengeId,
  sport,
  series,
  onRefresh,
}: {
  challengeId: string
  sport: string
  series: PlayoffSeriesView[]
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [syncing, startSyncing] = useTransition()
  const [recalculating, startRecalculating] = useTransition()
  const [lastSyncMsg, setLastSyncMsg] = useState<string | null>(null)

  const totalSeries = series.length
  const resolvedCount = series.filter((s) => s.status === "final").length
  const liveCount = series.filter((s) => s.status === "in_progress").length
  const pct = totalSeries > 0 ? Math.round((resolvedCount / totalSeries) * 100) : 0
  const allResolved = resolvedCount === totalSeries && totalSeries > 0

  function handleSyncLive() {
    startSyncing(async () => {
      try {
        const res = await fetch(`/api/brackets/playoffs/${challengeId}/sync-live`, {
          method: "POST",
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as any)?.error ?? "Sync failed")
        const updated = (data as any)?.seriesUpdated ?? 0
        const clinched = (data as any)?.newlyClinched ?? 0
        const msg =
          updated > 0
            ? `${updated} updated${clinched > 0 ? `, ${clinched} clinched` : ""}`
            : "No changes"
        setLastSyncMsg(msg)
        toast.success(updated > 0 ? `Synced — ${msg}` : "Sync complete — no changes")
        onRefresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Live sync failed")
      }
    })
  }

  function handleRecalculate() {
    startRecalculating(async () => {
      try {
        const res = await fetch(`/api/brackets/playoffs/${challengeId}/recalculate`, {
          method: "POST",
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as any)?.error ?? "Recalculate failed")
        const count = (data as any)?.entriesScored ?? 0
        toast.success(`Scores recalculated (${count} entries)`)
        onRefresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Recalculate failed")
      }
    })
  }

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-indigo-700" />
          <h2 className="text-sm font-black uppercase tracking-wide text-indigo-900">Commissioner</h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              allResolved
                ? "bg-emerald-200 text-emerald-900"
                : "bg-indigo-200 text-indigo-900"
            }`}
          >
            {resolvedCount}/{totalSeries} resolved
          </span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
              {liveCount} live
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-indigo-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-indigo-600" />
          )}
        </div>
      </button>

      {/* Progress bar */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: allResolved ? "#10b981" : "#6366f1",
          }}
        />
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Actions row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSyncLive}
              disabled={syncing || recalculating}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Zap className={`h-4 w-4 ${syncing ? "animate-pulse text-amber-500" : ""}`} />
              {syncing ? "Syncing…" : "Sync Live Scores"}
            </button>

            <button
              type="button"
              onClick={handleRecalculate}
              disabled={recalculating || syncing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw className={`h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
              {recalculating ? "Recalculating…" : "Recalculate Scores"}
            </button>

            {lastSyncMsg && !syncing && (
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                Last sync: {lastSyncMsg}
              </span>
            )}
          </div>

          {/* Series management */}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
              Series Status
            </h3>
            {series.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No series configured yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {series.map((s) => (
                  <SeriesResolveRow
                    key={s.id}
                    series={s}
                    challengeId={challengeId}
                    onResolved={onRefresh}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 border-t border-indigo-100 pt-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Resolved
            </span>
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-amber-500" /> Live
            </span>
            <span className="flex items-center gap-1">
              <Circle className="h-3 w-3 text-slate-400" /> Scheduled
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Main shell ───────────────────────────────────────────────────────────────

export default function PlayoffBracketShell({ initialView }: Props) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [refreshing, startRefreshing] = useTransition()
  const [creatingEntry, startCreatingEntry] = useTransition()
  const [copiedInvite, setCopiedInvite] = useState(false)

  const safeChallenge = {
    id: view?.challenge?.id || "unknown-challenge",
    sport: String(view?.challenge?.sport ?? "bracket").toLowerCase(),
    name: view?.challenge?.name || "Pool Dashboard",
    seasonYear: view?.challenge?.seasonYear ?? new Date().getUTCFullYear(),
    maxEntriesPerParticipant: Number(view?.challenge?.maxEntriesPerParticipant ?? 5),
    inviteUrl: view?.challenge?.inviteUrl || "/brackets",
    inviteCode: view?.challenge?.inviteCode || "",
    visibility: view?.challenge?.visibility || "private",
    maxParticipants: Number(view?.challenge?.maxParticipants ?? 0),
    scoringStyle: view?.challenge?.scoringStyle || "series_winner",
    lockRule: view?.challenge?.lockRule || "first_tipoff",
    isTestMode: Boolean(view?.challenge?.isTestMode),
    ownerUserId: view?.challenge?.ownerUserId || null,
  }
  const isOwner =
    safeChallenge.ownerUserId !== null && safeChallenge.ownerUserId === view?.viewerUserId

  const participants = Array.isArray(view?.participants) ? view.participants : []
  const entries = Array.isArray(view?.entries) ? view.entries : []
  const series = Array.isArray(view?.series) ? view.series : []
  const totalSeries = series.length
  const myEntries = entries.filter((entry) => entry.userId === view?.viewerUserId)
  const viewerEntryCount = myEntries.length
  const canCreateEntry = viewerEntryCount < safeChallenge.maxEntriesPerParticipant

  const primaryEntry = useMemo(() => {
    if (myEntries.length === 0) return null
    const activeViewerEntry =
      view.activeEntry && view.activeEntry.userId === view?.viewerUserId
        ? myEntries.find((entry) => entry.id === view.activeEntry?.id) ?? null
        : null
    return myEntries.find((entry) => !entry.isComplete) ?? activeViewerEntry ?? myEntries[0] ?? null
  }, [myEntries, view.activeEntry, view?.viewerUserId])

  const primaryButtonLabel = !primaryEntry
    ? "Create Your First Bracket"
    : primaryEntry.isComplete
      ? "View/Edit Bracket"
      : "Complete Bracket"

  const leaderboardRows = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => b.totalScore - a.totalScore || b.correctPicks - a.correctPicks
    )
    let currentRank = 1
    return sorted.map((entry, index) => {
      if (index > 0 && entry.totalScore === sorted[index - 1].totalScore) {
        // tied — share previous rank
      } else {
        currentRank = index + 1
      }
      return {
        rank: entry.rank ?? currentRank,
        id: entry.id,
        name: entry.name || `Bracket ${index + 1}`,
        totalScore: entry.totalScore,
        correctPicks: entry.correctPicks,
        pickCount: entry.pickCount,
        isComplete: entry.isComplete,
        userId: entry.userId,
      }
    })
  }, [entries])

  function handleRefresh() {
    startRefreshing(async () => {
      const latest = await getPlayoffBracketViewClient(safeChallenge.id)
      setView(latest)
    })
  }

  function openEntry(entryId: string) {
    router.push(`/brackets/leagues/${safeChallenge.id}/entries/${encodeURIComponent(entryId)}`)
  }

  function handleCreateEntry() {
    startCreatingEntry(async () => {
      try {
        const nextEntryIndex = viewerEntryCount + 1
        if (nextEntryIndex > safeChallenge.maxEntriesPerParticipant) {
          toast.error(`Entry limit reached (max ${safeChallenge.maxEntriesPerParticipant} per user)`)
          return
        }
        const created = await createPlayoffBracketEntryClient({ challengeId: safeChallenge.id })
        toast.success(`Bracket ${nextEntryIndex} created.`)
        router.push(created.redirectUrl)
        const latest = await getPlayoffBracketViewClient(safeChallenge.id)
        setView(latest)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to create entry"
        toast.error(message)
      }
    })
  }

  const inviteFullUrl = `${typeof window !== "undefined" ? window.location.origin : ""}${safeChallenge.inviteUrl}?code=${safeChallenge.inviteCode}`

  async function copyInvite() {
    try {
      const url = `${window.location.origin}${safeChallenge.inviteUrl}?code=${safeChallenge.inviteCode}`
      await navigator.clipboard.writeText(url)
      setCopiedInvite(true)
      toast.success("Invite link copied!")
      setTimeout(() => setCopiedInvite(false), 2500)
    } catch {
      toast.error("Could not copy invite link")
    }
  }

  // Pool health stats
  const resolvedCount = series.filter((s) => s.status === "final").length
  const liveCount = series.filter((s) => s.status === "in_progress").length

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
      {/* ── Pool header ── */}
      <section className="rounded-3xl border border-slate-300 bg-[linear-gradient(130deg,#fff7ed_0%,#ecfeff_45%,#eef2ff_100%)] p-6 shadow-[0_20px_50px_rgba(30,41,59,0.15)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
              {safeChallenge.name}
            </h1>
            <p className="mt-1 text-sm text-slate-700">
              {safeChallenge.sport.toUpperCase()} Playoff Pool · {safeChallenge.seasonYear}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-white">
            <Trophy className="h-4 w-4" />
            {entries.length} bracket{entries.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">
            {safeChallenge.sport.toUpperCase()}
          </span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-900">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
            {resolvedCount}/{totalSeries} series resolved
          </span>
          {liveCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-rose-800">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              {liveCount} live
            </span>
          )}
          {safeChallenge.isTestMode && (
            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">Test mode</span>
          )}
        </div>
      </section>

      {/* ── Live ticker ── */}
      <LiveSeriesTicker series={series} />

      {/* ── Details + invite ── */}
      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">League Details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div>
              <dt className="font-semibold">Scoring</dt>
              <dd className="capitalize">{safeChallenge.scoringStyle.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt className="font-semibold">Lock Rule</dt>
              <dd className="capitalize">{safeChallenge.lockRule.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt className="font-semibold">Max Brackets</dt>
              <dd>{safeChallenge.maxEntriesPerParticipant} per user</dd>
            </div>
            <div>
              <dt className="font-semibold">Invite Code</dt>
              <dd className="font-mono font-bold tracking-widest text-indigo-700">
                {safeChallenge.inviteCode}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (!primaryEntry) {
                  handleCreateEntry()
                  return
                }
                openEntry(primaryEntry.id)
              }}
              disabled={creatingEntry}
              data-testid="playoff-fill-bracket-cta"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowRightCircle className="h-4 w-4" />
              {primaryButtonLabel}
            </button>
            {primaryEntry && canCreateEntry && (
              <button
                type="button"
                onClick={handleCreateEntry}
                disabled={creatingEntry}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Another Bracket
              </button>
            )}
            <button
              type="button"
              onClick={copyInvite}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700"
            >
              {copiedInvite ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copiedInvite ? "Copied!" : "Invite"}
            </button>
          </div>

          {!canCreateEntry && (
            <p className="mt-2 text-xs font-semibold text-rose-700">
              Entry limit reached (max {safeChallenge.maxEntriesPerParticipant} per user).
            </p>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Invite Your Pool</h2>
          <p className="mt-2 text-sm text-slate-600">
            Share this link to invite players:
          </p>
          <div className="mt-2 flex items-stretch gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 break-all leading-relaxed">
              {safeChallenge.inviteUrl}?code={safeChallenge.inviteCode}
            </code>
            <button
              type="button"
              onClick={copyInvite}
              title="Copy invite link"
              className={`shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                copiedInvite
                  ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                  : "border-slate-300 bg-white text-slate-700 hover:border-sky-400 hover:text-sky-700"
              }`}
            >
              {copiedInvite ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Code: <span className="font-mono font-bold tracking-widest text-indigo-700">{safeChallenge.inviteCode}</span>
          </p>
        </article>
      </section>

      {/* ── Commissioner panel (owner only) ── */}
      {isOwner && (
        <CommissionerPanel
          challengeId={safeChallenge.id}
          sport={safeChallenge.sport}
          series={series}
          onRefresh={handleRefresh}
        />
      )}

      {/* ── Participants + My Brackets ── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Participants</h2>
          <p className="mt-1 text-xs text-slate-500">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </p>
          <ul className="mt-3 space-y-2">
            {participants.map((participant) => (
              <li
                key={participant.userId}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="font-semibold text-slate-800">{participant.displayName}</span>
                <span className="text-slate-500">
                  {participant.entryCount} bracket{participant.entryCount !== 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">My Brackets</h2>
          {myEntries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">You have not created a bracket yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {myEntries.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {entry.name || `Bracket ${index + 1}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      {entry.pickCount}/{totalSeries} picks ·{" "}
                      {entry.isComplete ? (
                        <span className="text-emerald-600">Complete</span>
                      ) : (
                        <span className="text-amber-600">In progress</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEntry(entry.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700"
                  >
                    {entry.isComplete ? "View" : "Fill out"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {/* ── Leaderboard ── */}
      <section
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        data-testid="playoff-dashboard-leaderboard"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Leaderboard</h2>
          {leaderboardRows.length > 0 && (
            <span className="text-xs text-slate-500">{leaderboardRows.length} bracket{leaderboardRows.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {leaderboardRows.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-2 py-4 text-center">
            <Trophy className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No brackets yet</p>
            <p className="text-xs text-slate-400">Be the first to fill out a bracket and claim the top spot!</p>
          </div>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {leaderboardRows.map((row) => {
              const isViewer = row.userId === view?.viewerUserId
              const rankIcon =
                row.rank === 1 ? "🥇" :
                row.rank === 2 ? "🥈" :
                row.rank === 3 ? "🥉" : null

              return (
                <li
                  key={row.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                    isViewer
                      ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {/* Rank */}
                  <div className="w-8 shrink-0 text-center">
                    {rankIcon ? (
                      <span className="text-base leading-none">{rankIcon}</span>
                    ) : (
                      <span className="text-xs font-black text-slate-400">#{row.rank}</span>
                    )}
                  </div>

                  {/* Name + meta */}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-semibold ${isViewer ? "text-indigo-900" : "text-slate-800"}`}>
                      {row.name}
                      {isViewer && <span className="ml-1.5 text-xs font-normal text-indigo-500">(you)</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.correctPicks} correct · {row.pickCount}/{totalSeries} picks
                      {!row.isComplete && <span className="text-amber-600"> · Incomplete</span>}
                    </p>
                  </div>

                  {/* Score */}
                  <div className="shrink-0 text-right">
                    <p className={`text-base font-black ${row.totalScore > 0 ? "text-slate-900" : "text-slate-400"}`}>
                      {row.totalScore}<span className="text-xs font-semibold text-slate-400"> pts</span>
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
