"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  getPlayoffBracketViewClient,
  savePlayoffBracketPickClient,
  submitPlayoffBracketEntryClient,
} from "@/lib/playoffs/playoffClientApi"
import {
  buildProjectedPlayoffSeries,
  getNextActionablePlayoffSeries,
  isPlayoffSeriesResolved,
} from "@/lib/playoffs/playoffBracketProjection"
import { getPlayoffCompletionSummary } from "@/lib/playoffs/playoffCompletion"
import { getPlayoffPickResult } from "@/lib/playoffs/playoffScoring"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import PlayoffBracketBoard from "./PlayoffBracketBoard"
import PlayoffSyncDiagnosticsPanel from "./PlayoffSyncDiagnosticsPanel"
import MlbBracketBoard from "./MlbBracketBoard"
import PlayoffSettingsModal from "./PlayoffSettingsModal"

type Props = {
  initialView: PlayoffChallengeView
}

type PlayoffProjectionMode = "official" | "user_projection"

/**
 * ⚠ MLB GETS A DIFFERENT BOARD, AND ONLY MLB. The 2026 design handoff is a
 * mirrored tree with a centre champion, which the NBA/NHL board is not; wiring
 * every sport onto it would restyle 26 live pools nobody asked to change. The
 * branch is on the sport string and nothing else, so an NBA pool renders
 * byte-identically to yesterday.
 */
const MLB_BOARD_SPORTS = new Set(["mlb"])

export default function PlayoffBracketEntryShell({ initialView }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const [view, setView] = useState(initialView)
  const [dirtySinceSubmit, setDirtySinceSubmit] = useState(false)
  const [saving, startSaving] = useTransition()
  const [submitting, startSubmitting] = useTransition()
  const [syncingSeries, startSyncingSeries] = useTransition()
  const [savingSeriesIds, setSavingSeriesIds] = useState<Set<string>>(new Set())
  const [savedSeriesIds, setSavedSeriesIds] = useState<Set<string>>(new Set())
  const [syncDiagnostics, setSyncDiagnostics] = useState<unknown>(null)
  const [showPickResults, setShowPickResults] = useState(false)
  const [showUserProjection, setShowUserProjection] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const activeEntry = view.activeEntry
  const series = Array.isArray(view.series) ? view.series : []
  const picks = Array.isArray(view.picks) ? view.picks : []
  const rounds = Array.isArray(view.rounds) ? view.rounds : []
  const officialSeries = useMemo(() => buildProjectedPlayoffSeries(series, picks, { includeUserPicks: false }), [series, picks])
  const myProjectedSeries = useMemo(() => buildProjectedPlayoffSeries(series, picks, { includeUserPicks: true }), [series, picks])
  const projectionMode: PlayoffProjectionMode = showUserProjection ? "official" : "user_projection"
  const projectedSeries = projectionMode === "user_projection" ? myProjectedSeries : officialSeries
  const totalSeries = series.length
  const pickCount = activeEntry?.pickCount ?? picks.length
  const lockRule = view.challenge.lockRule ?? view.challenge.config?.lockRule ?? "series_start"
  const hasTemplateSeries = series.some((item) => /^Winner\s+S\d+$/i.test(item.homeTeamName) || /^Winner\s+S\d+$/i.test(item.awayTeamName)) ||
    (view.challenge.isTestMode && !series.some((item) => item.winnerTeamName || item.status === "in_progress" || item.status === "final"))
  const hasAdminPoolAccess = hasPoolAdminAccess(session?.user) || view.lockDiagnostics?.hasPoolAdminAccess === true
  const canSyncSeries = view.challenge.ownerUserId === view.viewerUserId || hasAdminPoolAccess
  const canShowPickResultsToggle = activeEntry?.userId === view.viewerUserId || view.challenge.ownerUserId === view.viewerUserId || hasAdminPoolAccess
  const canUseLatePicks = view.lockDiagnostics?.viewerCanLatePick ?? (view.challenge.ownerUserId === view.viewerUserId || view.challenge.isTestMode || hasAdminPoolAccess)
  const showLockDiagnostics = canSyncSeries || canUseLatePicks
  const completion = useMemo(
    () => view.completion ?? getPlayoffCompletionSummary(myProjectedSeries, picks, {
      lockRule,
      isPoolOwner: view.challenge.ownerUserId === view.viewerUserId,
      isTestMode: view.challenge.isTestMode,
      hasPoolAdminAccess: hasAdminPoolAccess,
    }),
    [projectionMode, myProjectedSeries, picks, lockRule, view.challenge.ownerUserId, view.challenge.isTestMode, view.viewerUserId, hasAdminPoolAccess, view.completion],
  )
  const requiredSeriesIds = useMemo(() => new Set(completion?.missingRequiredSeriesIds ?? []), [completion?.missingRequiredSeriesIds])
  const nextActionableSeries = useMemo(() => {
    if (requiredSeriesIds.size > 0) {
      return projectedSeries
        .slice()
        .sort((a, b) => a.roundIndex - b.roundIndex || a.seriesNumber - b.seriesNumber)
        .find((item) => requiredSeriesIds.has(item.id)) ?? null
    }
    return getNextActionablePlayoffSeries(projectedSeries, picks)
  }, [projectedSeries, picks, completion?.missingRequiredSeriesIds])
  const pickResultSummary = useMemo(
    () => series.map((item) => ({
      series: item,
      result: getPlayoffPickResult(item, picks.find((pick) => pick.seriesId === item.id)),
    })),
    [series, picks],
  )
  const completionMode = completion?.mode ?? "full_bracket_required"
  const canSubmit = Boolean(activeEntry) && Boolean(completion?.isSubmittable ?? (totalSeries > 0 && pickCount >= totalSeries))
  const submitBlockedMessage = completion?.message ?? "Complete every series before submitting this bracket."
  const submitButtonLabel = completionMode === "available_picks_only" ? "Submit Available Picks" : "Submit Bracket"
  const reviewBadge = activeEntry.isComplete
    ? completionMode === "available_picks_only"
      ? "Partial verification submitted"
      : "Complete"
    : canSubmit && completionMode === "available_picks_only"
      ? "Complete for available picks"
      : "Incomplete"
  const hasOfficialSyncedSeries = series.some((item) => item.lastSyncedAt || item.providerGamesJson || item.seriesSummary || item.winnerTeamName || isPlayoffSeriesResolved(item))
  const hasSyncedResults = series.some((item) => Boolean(item.winnerTeamName))
  const showResultsSyncCallout = canSyncSeries && activeEntry.isComplete && completionMode === "available_picks_only" && !hasSyncedResults

  if (!activeEntry) {
    return null
  }

  function handlePick(seriesId: string, teamName: string) {
    if (savingSeriesIds.has(seriesId)) return
    const entryId = activeEntry.id
    const wasSubmitted = Boolean(view.activeEntry?.isComplete)
    setSavingSeriesIds((current) => new Set(current).add(seriesId))
    setSavedSeriesIds((current) => {
      const next = new Set(current)
      next.delete(seriesId)
      return next
    })
    startSaving(async () => {
      try {
        const next = await savePlayoffBracketPickClient({
          challengeId: view.challenge.id,
          entryId,
          seriesId,
          pickTeamName: teamName,
        })
        setView(next)
        setDirtySinceSubmit((current) => current || wasSubmitted)
        setSavedSeriesIds((current) => new Set(current).add(seriesId))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save pick")
      } finally {
        setSavingSeriesIds((current) => {
          const next = new Set(current)
          next.delete(seriesId)
          return next
        })
      }
    })
  }

  function continuePicking() {
    if (!nextActionableSeries) return
    document.getElementById(`playoff-series-${nextActionableSeries.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    })
  }

  function handleSubmit() {
    startSubmitting(async () => {
      try {
        const result = await submitPlayoffBracketEntryClient({
          challengeId: view.challenge.id,
          entryId: activeEntry.id,
        })
        toast.success("Bracket submitted")
        router.push(result.redirectUrl)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to submit bracket")
      }
    })
  }

  function handleSyncSeries() {
    startSyncingSeries(async () => {
      try {
        const response = await fetch(`/api/brackets/playoffs/${view.challenge.id}/admin/sync-series?mode=official_bracket`, {
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
        if (Number(payload?.seriesUpdated ?? 0) > 0) {
          toast.success(`${payload.seriesUpdated} playoff series updated. User picks were not filled.`)
          if (ignoredPlayInGames > 0) {
            toast.info("Play-In games were ignored for this bracket.")
          }
          if (trueWarnings.length > 0) {
            toast.warning(trueWarnings[0])
          }
        } else if (trueWarnings.length > 0) {
          toast.warning(trueWarnings[0])
        } else {
          toast.success("Official playoff data synced. User picks were not filled.")
        }
        const latest = await getPlayoffBracketViewClient(view.challenge.id)
        setView(latest)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to sync playoff series")
      }
    })
  }

  /*
   * The MLB surface replaces this shell's chrome rather than sitting inside
   * it — two heroes and two progress counters on one screen is worse than
   * either. Everything the legacy layout does that a pool still NEEDS is
   * carried across: back navigation, submit (with the blocked reason on the
   * disabled button), the commissioner sync, and settings. The review grid
   * and the projection toggle are not: the tree shows each series' result
   * inline, and it is always the entry's own projection, which is the only
   * mode you can pick from.
   */
  if (MLB_BOARD_SPORTS.has(String(view.challenge.sport ?? "").toLowerCase())) {
    return (
      <>
        <MlbBracketBoard
          view={view}
          onViewChange={(next) => {
            setView(next)
            setDirtySinceSubmit((current) => current || Boolean(activeEntry?.isComplete))
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          backHref={`/brackets/leagues/${view.challenge.id}`}
          backLabel="Back to pool dashboard"
          actions={
            <>
              <button
                type="button"
                className="af-pb-btn af-pb-btn--accent"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                title={canSubmit ? undefined : submitBlockedMessage}
                data-testid="pb-submit"
              >
                {submitting
                  ? "Submitting…"
                  : dirtySinceSubmit && activeEntry.isComplete
                    ? `Re-${submitButtonLabel}`
                    : submitButtonLabel}
              </button>
              {canSyncSeries ? (
                <button
                  type="button"
                  className="af-pb-btn"
                  onClick={handleSyncSeries}
                  disabled={syncingSeries}
                  data-testid="pb-sync"
                >
                  {syncingSeries ? "Syncing…" : "Sync official data"}
                </button>
              ) : null}
            </>
          }
        />
        {settingsOpen ? (
          <PlayoffSettingsModal
            view={view}
            canAdmin={canSyncSeries}
            onClose={() => setSettingsOpen(false)}
            onResync={handleSyncSeries}
            resyncing={syncingSeries}
          />
        ) : null}
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-slate-300 bg-[linear-gradient(130deg,#fff7ed_0%,#ecfeff_45%,#eef2ff_100%)] p-6 shadow-[0_20px_50px_rgba(30,41,59,0.15)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/brackets/leagues/${view.challenge.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Pool Dashboard
            </Link>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{activeEntry.name}</h1>
            <p className="mt-1 text-sm text-slate-700">{view.challenge.name} - {String(view.challenge.sport ?? "").toUpperCase()}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-white">{pickCount}/{totalSeries} picks</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Autosave on</span>
            {saving ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </span>
            ) : null}
          </div>
        </div>
        {hasTemplateSeries ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span data-testid="playoff-entry-template-warning">Template teams shown until playoff series sync runs. Syncing official data does not fill user picks.</span>
            </div>
            {canSyncSeries ? (
              <button
                type="button"
                onClick={handleSyncSeries}
                disabled={syncingSeries}
                data-testid="playoff-entry-sync-series-button"
                className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncingSeries ? "Syncing..." : "Sync official data"}
              </button>
            ) : null}
          </div>
        ) : null}
        {canSyncSeries ? (
          <PlayoffSyncDiagnosticsPanel diagnostics={syncDiagnostics} testId="playoff-entry-sync-diagnostics" />
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Bracket Entry</h2>
            <p className="mt-1 text-sm text-slate-600">
              Picks save automatically. Finish available series first, then projected later rounds unlock.
            </p>
            {showLockDiagnostics ? (
              <p data-testid="playoff-entry-lock-diagnostics" className="mt-2 text-xs font-semibold text-slate-500">
                lockRule={lockRule}; allowTestLatePicks={String(view.lockDiagnostics?.allowTestLatePicks ?? false)}; viewerCanLatePick={String(canUseLatePicks)}
              </p>
            ) : null}
            <p data-testid="playoff-next-pick-guidance" className="mt-2 text-sm font-semibold text-slate-700">
              {nextActionableSeries
                ? `${completion?.savedRequiredPickCount ?? pickCount}/${completion?.requiredPickCount ?? totalSeries} required picks complete. Next pick: Series ${nextActionableSeries.seriesNumber}.`
                : canSubmit
                  ? completionMode === "available_picks_only"
                    ? "All currently available series are picked."
                    : "All series picks are complete."
                  : "No later-round picks are available yet. Pick earlier round winners first."}
            </p>
            {completionMode === "available_picks_only" && (completion?.unavailableSeriesCount ?? 0) > 0 ? (
              <p data-testid="playoff-entry-partial-submit-note" className="mt-2 text-sm font-semibold text-sky-700">
                Later official matchups are still TBD and will remain pending.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {canShowPickResultsToggle ? (
              <button
                type="button"
                onClick={() => setShowPickResults((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-400"
                data-testid="playoff-show-pick-results-toggle"
              >
                {showPickResults ? "Hide Pick Results" : "Show Pick Results"}
              </button>
            ) : null}
            {hasOfficialSyncedSeries ? (
              <button
                type="button"
                onClick={() => setShowUserProjection((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400"
                data-testid="playoff-user-projection-toggle"
              >
                {projectionMode === "official" ? "Show My Projection" : "Show Official Bracket"}
              </button>
            ) : null}
            <p className="w-full text-xs font-semibold text-slate-500">
              Syncing official data does not fill user picks.
            </p>
            <button
              type="button"
              onClick={continuePicking}
              disabled={!nextActionableSeries}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue Picking
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {dirtySinceSubmit && activeEntry.isComplete ? `Re-${submitButtonLabel}` : submitButtonLabel}
            </button>
          </div>
        </div>
        {!canSubmit ? (
          <p className="mt-3 text-sm text-amber-700">{submitBlockedMessage}</p>
        ) : null}
        {dirtySinceSubmit ? (
          <p className="mt-3 text-sm text-sky-700">You changed a submitted bracket. Re-submit to confirm the latest picks.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm" data-testid="playoff-entry-review-summary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">Review Area</p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-slate-900">Review Picks</h2>
            <p className="mt-1 text-sm text-slate-600">Official results are for verification only. Submitting does not create or change picks.</p>
            <p data-testid="playoff-entry-review-results-note" className="mt-2 text-sm font-semibold text-slate-700">
              {hasSyncedResults
                ? "Official results are synced. Correct/Wrong badges reflect your saved picks."
                : "Results have not been synced yet. Your picks will show Pending until the commissioner runs Sync results only."}
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            {reviewBadge}
          </span>
        </div>
        {showResultsSyncCallout ? (
          <div
            data-testid="playoff-entry-sync-results-callout"
            className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800"
          >
            To verify right/wrong picks, return to the pool dashboard and run Sync results only.
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {pickResultSummary.map(({ series: item, result }) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span>Series {item.seriesNumber}</span>
                <span>
                  {result.status === "correct"
                    ? `Correct +${result.points}`
                    : result.status === "wrong"
                      ? `Wrong +${result.points}`
                      : result.status === "pending"
                        ? "Pending"
                        : "No Pick"}
                </span>
              </div>
              <p className="mt-1 text-slate-500">Your pick: {result.pickTeamName ?? "No Pick"}</p>
              <p className="mt-1 text-slate-500">Result: {result.seriesSummary ?? (result.winnerTeamName ? `${result.winnerTeamName} wins` : "Result pending")}</p>
            </div>
          ))}
        </div>
      </section>

      <PlayoffBracketBoard
        rounds={rounds}
        series={projectedSeries}
        picks={picks}
        onPick={handlePick}
        savingSeriesIds={savingSeriesIds}
        savedSeriesIds={savedSeriesIds}
        nextSeriesId={nextActionableSeries?.id ?? null}
        showPickResults={canShowPickResultsToggle && showPickResults}
        officialBracketMode={projectionMode === "official"}
        projectionMode={projectionMode}
        lockRule={lockRule}
        canUseLatePicks={canUseLatePicks}
        showLockDiagnostics={showLockDiagnostics}
        lockDiagnostics={view.lockDiagnostics}
      />
    </div>
  )
}