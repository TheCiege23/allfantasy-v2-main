"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Loader2, Trophy } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView, PlayoffPickView } from "@/lib/playoffs/types"
import {
  indexSeriesByNumber,
  mergePickTeamNamesWithOverlay,
  projectBracketSeriesSides,
} from "@/lib/playoffs/playoffBracketProjection"
import {
  officialNbaPlayoffUiPresentation,
  officialNhlPlayoffUiPresentation,
  playoffChallengeLeaderboardHref,
} from "@/lib/playoffs/playoffBracketDataSource"
import {
  getPlayoffBracketViewClient,
  savePlayoffBracketPickClient,
  submitPlayoffBracketEntryClient,
} from "@/lib/playoffs/playoffClientApi"
import PlayoffBracketBoard from "./PlayoffBracketBoard"

type Props = {
  initialView: PlayoffChallengeView
}

export default function PlayoffBracketEntryShell({ initialView }: Props) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [dirtySinceSubmit, setDirtySinceSubmit] = useState(false)
  const [optimisticOverlayBySeriesId, setOptimisticOverlayBySeriesId] = useState<Record<string, string>>({})
  /** Per-series generations so stale saves never overwrite optimistic state. */
  const pickSaveGenerationRef = useRef<Record<string, number>>({})
  const [seriesSavingLookup, setSeriesSavingLookup] = useState<Record<string, boolean>>({})
  const [submitting, startSubmitting] = useTransition()

  const activeEntry = view.activeEntry
  const series = Array.isArray(view.series) ? view.series : []
  const picks = Array.isArray(view.picks) ? view.picks : []
  const rounds = Array.isArray(view.rounds) ? view.rounds : []
  const sportLc = String(view.challenge.sport ?? "").toLowerCase()
  const nhlTemplateDisclaimer = sportLc === "nhl" && officialNhlPlayoffUiPresentation() === "lab_template"
  const nbaTemplateDisclaimer = sportLc === "nba" && officialNbaPlayoffUiPresentation() === "lab_template"

  const mergedPickNames = useMemo(
    () => mergePickTeamNamesWithOverlay(picks, optimisticOverlayBySeriesId),
    [picks, optimisticOverlayBySeriesId]
  )

  const boardSeries = useMemo(() => {
    const byNumber = indexSeriesByNumber(series)
    return series.map((item) => {
      const projected = projectBracketSeriesSides(item, byNumber, mergedPickNames)
      return {
        ...item,
        displayHomeTeamName: projected.displayHomeTeamName,
        displayAwayTeamName: projected.displayAwayTeamName,
        homeSelectable: projected.homeSelectable,
        awaySelectable: projected.awaySelectable,
      }
    })
  }, [series, mergedPickNames])

  const totalSeries = series.length

  const filledPickSlots = useMemo(() => {
    return series.reduce((acc, row) => {
      const chosen = mergedPickNames.get(row.id)
      return chosen != null && String(chosen).trim() !== "" ? acc + 1 : acc
    }, 0)
  }, [series, mergedPickNames])

  const anySeriesSaving = useMemo(() => Object.keys(seriesSavingLookup).length > 0, [seriesSavingLookup])

  const isSeriesSaving = useCallback(
    (seriesId: string) => Boolean(seriesSavingLookup[seriesId]),
    [seriesSavingLookup]
  )

  const effectivePicks: PlayoffPickView[] = useMemo(() => {
    if (!activeEntry) {
      return picks
    }
    const bySeries = new Map(picks.map((p) => [p.seriesId, p]))
    for (const s of series) {
      const fromServer = bySeries.get(s.id)
      const overlay = optimisticOverlayBySeriesId[s.id]
      if (overlay !== undefined && String(overlay).trim() !== "") {
        const base =
          fromServer ??
          ({
            id: `local-${s.id}`,
            entryId: activeEntry.id,
            seriesId: s.id,
            pickTeamName: overlay,
            createdAt: "",
            updatedAt: "",
          } as PlayoffPickView)
        bySeries.set(s.id, { ...base, pickTeamName: overlay })
      }
    }
    return Array.from(bySeries.values())
  }, [series, picks, optimisticOverlayBySeriesId, activeEntry])

  const canSubmit = Boolean(activeEntry) && totalSeries > 0 && filledPickSlots >= totalSeries

  function handlePick(seriesId: string, teamName: string) {
    const entry = view.activeEntry
    if (!entry) return

    const wasSubmitted = Boolean(view.activeEntry?.isComplete)
    const challengeId = view.challenge.id

    const gen = (pickSaveGenerationRef.current[seriesId] ?? 0) + 1
    pickSaveGenerationRef.current[seriesId] = gen

    setOptimisticOverlayBySeriesId((prev) => ({ ...prev, [seriesId]: teamName }))
    setSeriesSavingLookup((prev) => ({ ...prev, [seriesId]: true }))

    void savePlayoffBracketPickClient({
      challengeId,
      entryId: entry.id,
      seriesId,
      pickTeamName: teamName,
    })
      .then((next) => {
        if (pickSaveGenerationRef.current[seriesId] !== gen) return
        setOptimisticOverlayBySeriesId((prev) => {
          const rest = { ...prev }
          delete rest[seriesId]
          return rest
        })
        setView(next)
        setDirtySinceSubmit((current) => current || wasSubmitted)
      })
      .catch((error) => {
        if (pickSaveGenerationRef.current[seriesId] !== gen) return
        setOptimisticOverlayBySeriesId((prev) => {
          const rest = { ...prev }
          delete rest[seriesId]
          return rest
        })
        toast.error(error instanceof Error ? error.message : "Unable to save pick")
        void getPlayoffBracketViewClient(challengeId)
          .then(setView)
          .catch(() => {
            /* ignore resync failure */
          })
      })
      .finally(() => {
        if (pickSaveGenerationRef.current[seriesId] !== gen) return
        setSeriesSavingLookup((prev) => {
          const rest = { ...prev }
          delete rest[seriesId]
          return rest
        })
      })
  }

  function handleSubmit() {
    if (!activeEntry) return

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

  if (!activeEntry) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 sm:p-6">
      {nbaTemplateDisclaimer ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-amber-400/80 bg-amber-100 px-4 py-3 text-amber-950 shadow-sm sm:px-5 sm:py-4"
          data-testid="playoff-entry-nba-template-banner"
        >
          <p className="text-xs font-black uppercase tracking-wide text-amber-900/90">Test / template NBA bracket</p>
          <p className="mt-1 text-sm font-semibold leading-snug">
            You are picking on a <span className="underline decoration-amber-700/50">lab bracket</span>, not live NBA postseason
            seeding. Names and pairings are illustrative until official playoff sync is connected.
          </p>
        </div>
      ) : null}
      {nhlTemplateDisclaimer ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-amber-400/80 bg-amber-100 px-4 py-3 text-amber-950 shadow-sm sm:px-5 sm:py-4"
          data-testid="playoff-entry-nhl-template-banner"
        >
          <p className="text-xs font-black uppercase tracking-wide text-amber-900/90">Test / template NHL bracket</p>
          <p className="mt-1 text-sm font-semibold leading-snug">
            You are picking on a <span className="underline decoration-amber-700/50">lab bracket</span>, not live NHL postseason
            seeding. Names and pairings are illustrative until official playoff sync is connected.
          </p>
        </div>
      ) : null}
      <section className="rounded-3xl border border-slate-300 bg-[linear-gradient(130deg,#fff7ed_0%,#ecfeff_45%,#eef2ff_100%)] p-6 shadow-[0_20px_50px_rgba(30,41,59,0.15)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <Link href={`/brackets/leagues/${view.challenge.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" />
                Back to Pool Dashboard
              </Link>
              <div className="flex min-w-[12rem] max-w-xs flex-col gap-0.5">
                <Link
                  href={playoffChallengeLeaderboardHref(view.challenge.id)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-sky-800 hover:text-sky-950"
                  data-testid="playoff-entry-leaderboard-link"
                >
                  <Trophy className="h-4 w-4 shrink-0" />
                  View Pool Leaderboard
                </Link>
                <p className="pl-[1.375rem] text-[11px] font-medium leading-snug text-slate-500">
                  Opens the pool dashboard leaderboard.
                </p>
              </div>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{activeEntry.name}</h1>
            <p className="mt-1 text-sm text-slate-700">
              {view.challenge.name} - {String(view.challenge.sport ?? "").toUpperCase()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-white">
              {filledPickSlots}/{totalSeries} picks
            </span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Autosave on</span>
            {anySeriesSaving ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Bracket Entry</h2>
            <p className="mt-1 text-sm text-slate-600">
              Picks save automatically. Finish every series, then submit to return to the pool dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {dirtySinceSubmit && activeEntry.isComplete ? "Re-Submit Bracket" : "Submit Bracket"}
          </button>
        </div>
        {!canSubmit ? (
          <p className="mt-3 text-sm text-amber-700">Complete every series before submitting this bracket.</p>
        ) : null}
        {dirtySinceSubmit ? (
          <p className="mt-3 text-sm text-sky-700">You changed a submitted bracket. Re-submit to confirm the latest picks.</p>
        ) : null}
      </section>

      <section
        className={
          sportLc === "nba"
            ? "rounded-2xl border border-white/10 bg-[linear-gradient(145deg,#05070b_0%,#080f1c_100%)] p-4 shadow-[0_24px_55px_rgba(0,0,0,0.45)] sm:p-5"
            : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        }
        data-testid={sportLc === "nba" ? "playoff-entry-board-wrap-nba" : undefined}
      >
        <PlayoffBracketBoard
          sport={view.challenge.sport}
          rounds={rounds}
          series={boardSeries}
          picks={effectivePicks}
          onPick={handlePick}
          isSeriesSaving={isSeriesSaving}
        />
      </section>
    </div>
  )
}
