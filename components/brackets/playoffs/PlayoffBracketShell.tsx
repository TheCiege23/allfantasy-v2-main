"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { RefreshCw, Trophy, Plus, Link2, Clipboard, Settings2, ArrowRightCircle, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  createPlayoffBracketEntryClient,
  getPlayoffBracketViewClient,
} from "@/lib/playoffs/playoffClientApi"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import PlayoffSyncDiagnosticsPanel from "./PlayoffSyncDiagnosticsPanel"

type Props = {
  initialView: PlayoffChallengeView
}

type PlayoffDashboardSyncMode = "teams_schedule_only" | "results_only" | "official_bracket" | "autofill_results"

const SYNC_SUCCESS_MESSAGES: Record<PlayoffDashboardSyncMode, string> = {
  teams_schedule_only: "Teams and schedule updated. User picks were not changed.",
  results_only: "Results synced. Reopen the entry or use Show Pick Results to verify Correct/Wrong picks.",
  official_bracket: "Official bracket data synced. User picks were not changed.",
  autofill_results: "Testing only sync completed. Picks were filled from official winners.",
}

export default function PlayoffBracketShell({ initialView }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const syncToolsRef = useRef<HTMLElement | null>(null)
  const [view, setView] = useState(initialView)
  const [refreshing, startRefreshing] = useTransition()
  const [creatingEntry, startCreatingEntry] = useTransition()
  const [syncingSeries, startSyncingSeries] = useTransition()
  const [syncDiagnostics, setSyncDiagnostics] = useState<unknown>(null)
  const [syncStatus, setSyncStatus] = useState<{ type: "success" | "error"; message: string } | null>(null)

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
  const hasTemplateSeries = series.some((item) => /^Winner\s+S\d+$/i.test(item.homeTeamName) || /^Winner\s+S\d+$/i.test(item.awayTeamName)) ||
    (safeChallenge.isTestMode && !series.some((item) => item.winnerTeamName || item.status === "in_progress" || item.status === "final"))
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
  const leaderboardRows = useMemo(
    () => {
      const hasScoredResults = entries.some((entry) => (entry.resolvedPicks ?? 0) > 0 || (entry.totalScore ?? 0) > 0 || (entry.correctPicks ?? 0) > 0)
      return [...entries]
        .sort((a, b) => {
          if (hasScoredResults) {
            return (b.totalScore ?? 0) - (a.totalScore ?? 0) || (b.correctPicks ?? 0) - (a.correctPicks ?? 0) || b.pickCount - a.pickCount
          }
          return b.pickCount - a.pickCount
        })
        .map((entry, index) => ({
          rank: index + 1,
          id: entry.id,
          name: entry.name || `Bracket ${index + 1}`,
          picks: entry.pickCount,
          totalScore: entry.totalScore ?? 0,
          correctPicks: entry.correctPicks ?? 0,
          resolvedPicks: entry.resolvedPicks ?? 0,
          hasScoredResults,
        }))
    },
    [entries]
  )
  const hasScoredLeaderboard = leaderboardRows.some((row) => row.hasScoredResults)
  const hasClientAdminAccess = hasPoolAdminAccess(session?.user)
  const hasServerAdminAccess = view.lockDiagnostics?.hasPoolAdminAccess === true
  const hasAdminAccess = hasClientAdminAccess || hasServerAdminAccess
  const canManagePlayoffPool = safeChallenge.ownerUserId === view?.viewerUserId || hasAdminAccess
  const canUseAutofillResults = safeChallenge.isTestMode && hasAdminAccess
  const isOwner = safeChallenge.ownerUserId === view?.viewerUserId

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

  function handleSyncSeries(mode: PlayoffDashboardSyncMode = "official_bracket") {
    startSyncingSeries(async () => {
      try {
        setSyncStatus(null)
        const response = await fetch(`/api/brackets/playoffs/${safeChallenge.id}/admin/sync-series?mode=${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to sync playoff series")
        }
        setSyncDiagnostics(payload)
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : []
        const ignoredPlayInGames = Number(payload?.diagnostics?.ignoredPlayInGames ?? 0)
        const trueWarnings = warnings.filter((warning: unknown) => !String(warning).toLowerCase().includes("play-in games ignored"))
        const successMessage = SYNC_SUCCESS_MESSAGES[mode]
        if (Number(payload?.seriesUpdated ?? 0) > 0) {
          toast.success(successMessage)
          if (ignoredPlayInGames > 0) {
            toast.info("Play-In games were ignored for this bracket.")
          }
          if (trueWarnings.length > 0) {
            toast.warning(trueWarnings[0])
          }
        } else if (trueWarnings.length > 0) {
          toast.warning(trueWarnings[0])
        } else {
          toast.success(successMessage)
        }
        setSyncStatus({ type: "success", message: successMessage })
        const latest = await getPlayoffBracketViewClient(safeChallenge.id)
        setView(latest)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sync playoff series"
        setSyncStatus({ type: "error", message })
        toast.error(message)
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
        {hasTemplateSeries ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span data-testid="playoff-template-warning">Template teams shown until playoff series sync runs. Teams/Schedule sync does not import winners. Results sync scores finalized picks.</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Pool Details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div><dt className="font-semibold">Visibility</dt><dd>{safeChallenge.visibility}</dd></div>
            <div><dt className="font-semibold">Max Users</dt><dd>{safeChallenge.maxParticipants}</dd></div>
            <div><dt className="font-semibold">Brackets per User</dt><dd>{safeChallenge.maxEntriesPerParticipant}</dd></div>
            <div><dt className="font-semibold">Scoring Style</dt><dd>{safeChallenge.scoringStyle}</dd></div>
            <div><dt className="font-semibold">Lock Rule</dt><dd>{safeChallenge.lockRule}</dd></div>
            {canManagePlayoffPool && (
              <div data-testid="playoff-invite-code-cell">
                <dt className="font-semibold">Invite Code</dt>
                <dd>{safeChallenge.inviteCode}</dd>
              </div>
            )}
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
            {canManagePlayoffPool && (
              <button
                type="button"
                onClick={copyInvite}
                data-testid="playoff-copy-invite-btn"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 hover:text-sky-700"
              >
                <Clipboard className="h-4 w-4" />
                Invite
              </button>
            )}
            {canManagePlayoffPool ? (
              <button
                type="button"
                onClick={() => syncToolsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
              >
                <Settings2 className="h-4 w-4" />
                Commissioner Tools
              </button>
            ) : null}
          </div>
          {!canCreateEntry ? (
            <p className="mt-2 text-xs font-semibold text-rose-700">Entry limit reached. Bracket 6 is blocked.</p>
          ) : null}
        </article>

        {canManagePlayoffPool ? (
          <article
            data-testid="playoff-invite-panel"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Invite Panel</h2>
            <p className="mt-2 text-sm text-slate-700">
              Share this link:{" "}
              <span className="font-semibold">
                {safeChallenge.inviteUrl}?code={safeChallenge.inviteCode}
              </span>
            </p>
            <button
              type="button"
              onClick={copyInvite}
              data-testid="playoff-copy-invite-link-btn"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            >
              <Link2 className="h-4 w-4" />
              Copy invite link
            </button>
          </article>
        ) : (
          <article
            data-testid="playoff-invite-member-banner"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Invite</h2>
            <p className="mt-2 text-sm text-slate-500">
              Only the pool commissioner can copy and share the invite link.
              Ask your commissioner for the invite link or code.
            </p>
          </article>
        )}
      </section>

      {canManagePlayoffPool ? (
        <section
          ref={syncToolsRef}
          id="playoff-commissioner-sync-tools"
          data-testid="playoff-commissioner-sync-tools"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Commissioner Sync Tools</h2>
              <p className="mt-1 text-sm text-slate-600">
                Provider sync updates official NBA/NHL playoff data. User picks are not created unless the testing-only auto-fill action is used.
              </p>
              <p data-testid="playoff-sync-tools-visibility-debug" className="mt-1 text-xs font-semibold text-slate-500">
                syncToolsVisible=true; isOwner={String(isOwner)}; isAdmin={String(hasAdminAccess)}; hasPoolAdminAccess={String(hasAdminAccess)}
              </p>
            </div>
            {syncingSeries ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Syncing
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => handleSyncSeries("teams_schedule_only")}
              disabled={syncingSeries}
              data-testid="playoff-sync-schedule-only-button"
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-black text-amber-950">Sync teams/schedule only</span>
              <span className="mt-1 block text-xs font-semibold text-amber-800">Loads teams, dates, venues, broadcast. Does not import winners.</span>
            </button>
            <button
              type="button"
              onClick={() => handleSyncSeries("results_only")}
              disabled={syncingSeries}
              data-testid="playoff-sync-results-only-button"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-black text-emerald-950">Sync results only</span>
              <span className="mt-1 block text-xs font-semibold text-emerald-800">Imports final winners/results and scores saved picks.</span>
            </button>
            <button
              type="button"
              onClick={() => handleSyncSeries("official_bracket")}
              disabled={syncingSeries}
              data-testid="playoff-sync-series-button"
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-black text-sky-950">Sync official bracket</span>
              <span className="mt-1 block text-xs font-semibold text-sky-800">Updates all known official bracket data. Does not fill user picks.</span>
            </button>
          </div>

          {canUseAutofillResults ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-rose-200/70 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-rose-900">
                Test-mode only
              </div>
              <button
                type="button"
                onClick={() => handleSyncSeries("autofill_results")}
                disabled={syncingSeries}
                data-testid="playoff-sync-autofill-results-button"
                className="block rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-bold text-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Auto-fill official results
              </button>
              <p className="mt-2 text-xs font-semibold text-rose-800">Testing only — fills picks from official winners.</p>
            </div>
          ) : (
            <p
              data-testid="playoff-sync-autofill-unavailable"
              className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"
            >
              Auto-fill official results is available only in test-mode pools (AllFantasy staff only).
            </p>
          )}

          {syncStatus ? (
            <p
              data-testid="playoff-sync-status-message"
              className={`mt-3 rounded-xl border px-3 py-2 text-sm font-semibold ${
                syncStatus.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              {syncStatus.message}
            </p>
          ) : null}
          <PlayoffSyncDiagnosticsPanel diagnostics={syncDiagnostics} />
        </section>
      ) : null}

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
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {hasScoredLeaderboard ? "Scored leaderboard from completed series results." : "Pick-count leaderboard until series results sync."}
        </p>
        {leaderboardRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No leaderboard entries yet.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {leaderboardRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-800">#{row.rank} {row.name}</span>
                <span className="text-slate-600">
                  {row.hasScoredResults ? `${row.totalScore} pts · ${row.correctPicks}/${row.resolvedPicks} correct · ` : ""}
                  {row.picks} picks
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
