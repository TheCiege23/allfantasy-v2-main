"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Trophy, Plus, Link2, Clipboard, Settings2, ArrowRightCircle } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  createPlayoffBracketEntryClient,
  getPlayoffBracketViewClient,
} from "@/lib/playoffs/playoffClientApi"

type Props = {
  initialView: PlayoffChallengeView
}

export default function PlayoffBracketShell({ initialView }: Props) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [refreshing, startRefreshing] = useTransition()
  const [creatingEntry, startCreatingEntry] = useTransition()
  const [recalculating, startRecalculating] = useTransition()

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
  const participants = Array.isArray(view?.participants) ? view.participants : []
  const entries = Array.isArray(view?.entries) ? view.entries : []
  const series = Array.isArray(view?.series) ? view.series : []
  const totalSeries = series.length
  const myEntries = entries.filter((entry) => entry.userId === view?.viewerUserId)
  const viewerEntryCount = myEntries.length
  const canCreateEntry = viewerEntryCount < safeChallenge.maxEntriesPerParticipant
  const primaryEntry = useMemo(() => {
    if (myEntries.length === 0) return null
    const activeViewerEntry = view.activeEntry && view.activeEntry.userId === view?.viewerUserId
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
          toast.error("Entry limit reached (max 5 per user)")
          return
        }

        const created = await createPlayoffBracketEntryClient({
          challengeId: safeChallenge.id,
        })

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

  function handleRecalculate() {
    startRecalculating(async () => {
      try {
        const res = await fetch(`/api/brackets/playoffs/${safeChallenge.id}/recalculate`, {
          method: "POST",
        })
        if (!res.ok) throw new Error("Recalculate failed")
        toast.success("Scores recalculated")
        const latest = await getPlayoffBracketViewClient(safeChallenge.id)
        setView(latest)
      } catch {
        toast.error("Could not recalculate scores")
      }
    })
  }

  async function copyInvite() {
    try {
      const absoluteUrl = `${window.location.origin}${safeChallenge.inviteUrl}`
      await navigator.clipboard.writeText(`${absoluteUrl}?code=${safeChallenge.inviteCode}`)
      toast.success("Invite link copied")
    } catch {
      toast.error("Could not copy invite link")
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-slate-300 bg-[linear-gradient(130deg,#fff7ed_0%,#ecfeff_45%,#eef2ff_100%)] p-6 shadow-[0_20px_50px_rgba(30,41,59,0.15)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{safeChallenge.name}</h1>
            <p className="mt-1 text-sm text-slate-700">{String(safeChallenge.sport ?? "").toUpperCase()} pool - {safeChallenge.seasonYear}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-white">
            <Trophy className="h-4 w-4" />
            {entries.length} bracket{entries.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">{String(safeChallenge.sport ?? "").toUpperCase()}</span>
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-900">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{totalSeries} series</span>
          {safeChallenge.isTestMode ? <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">Test mode</span> : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">League Details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div><dt className="font-semibold">Visibility</dt><dd>{safeChallenge.visibility}</dd></div>
            <div><dt className="font-semibold">Max Users</dt><dd>{safeChallenge.maxParticipants}</dd></div>
            <div><dt className="font-semibold">Brackets per User</dt><dd>{safeChallenge.maxEntriesPerParticipant}</dd></div>
            <div><dt className="font-semibold">Scoring Style</dt><dd>{safeChallenge.scoringStyle}</dd></div>
            <div><dt className="font-semibold">Lock Rule</dt><dd>{safeChallenge.lockRule}</dd></div>
            <div><dt className="font-semibold">Invite Code</dt><dd>{safeChallenge.inviteCode}</dd></div>
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
            {primaryEntry && canCreateEntry ? (
              <button
                type="button"
                onClick={handleCreateEntry}
                disabled={creatingEntry}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Create Another Bracket
              </button>
            ) : null}
            <button
              type="button"
              onClick={copyInvite}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700"
            >
              <Clipboard className="h-4 w-4" />
              Invite
            </button>
            {safeChallenge.ownerUserId && safeChallenge.ownerUserId === view?.viewerUserId ? (
              <button
                type="button"
                onClick={handleRecalculate}
                disabled={recalculating}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Settings2 className="h-4 w-4" />
                {recalculating ? "Recalculating…" : "Recalculate Scores"}
              </button>
            ) : null}
          </div>
          {!canCreateEntry ? (
            <p className="mt-2 text-xs font-semibold text-rose-700">Entry limit reached. Bracket 6 is blocked.</p>
          ) : null}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Invite Panel</h2>
          <p className="mt-2 text-sm text-slate-700">
            Share this link: <span className="font-semibold">{safeChallenge.inviteUrl}?code={safeChallenge.inviteCode}</span>
          </p>
          <button
            type="button"
            onClick={copyInvite}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <Link2 className="h-4 w-4" />
            Copy invite link
          </button>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Participants</h2>
          <p className="mt-1 text-sm text-slate-600">
            {participants.length} participant{participants.length !== 1 ? "s" : ""}
          </p>
          <ul className="mt-3 space-y-2">
            {participants.map((participant) => (
              <li key={participant.userId} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-800">{participant.displayName}</span>
                <span className="text-slate-600">{participant.entryCount} entries</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">My Brackets / Entries</h2>
          {myEntries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">You have not created a bracket in this pool yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {myEntries.map((entry, index) => (
                <li key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{entry.name || `Bracket ${index + 1}`}</p>
                    <p className="text-xs text-slate-600">
                      {entry.pickCount}/{totalSeries} picks · {entry.isComplete ? "Complete" : "In progress"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEntry(entry.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {entry.isComplete ? "View/Edit Bracket" : "Complete Bracket"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="playoff-dashboard-leaderboard">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Leaderboard</h2>
        {leaderboardRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No leaderboard entries yet.</p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {leaderboardRows.map((row) => (
              <li
                key={row.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  row.userId === view?.viewerUserId
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 text-center text-xs font-black text-slate-400">#{row.rank}</span>
                  <div>
                    <p className="font-semibold text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      {row.pickCount}/{totalSeries} picks · {row.isComplete ? "Complete" : "In progress"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-black text-slate-900">{row.totalScore} pts</p>
                  <p className="text-xs text-slate-500">{row.correctPicks} correct</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
