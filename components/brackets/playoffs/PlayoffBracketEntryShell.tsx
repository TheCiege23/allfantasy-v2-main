"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  savePlayoffBracketPickClient,
  submitPlayoffBracketEntryClient,
} from "@/lib/playoffs/playoffClientApi"
import PlayoffBracketBoard from "./PlayoffBracketBoard"
import LiveSeriesTicker from "./LiveSeriesTicker"

type Props = {
  initialView: PlayoffChallengeView
}

export default function PlayoffBracketEntryShell({ initialView }: Props) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [dirtySinceSubmit, setDirtySinceSubmit] = useState(false)
  const [saving, startSaving] = useTransition()
  const [submitting, startSubmitting] = useTransition()

  const activeEntry = view.activeEntry
  const series = Array.isArray(view.series) ? view.series : []
  const picks = Array.isArray(view.picks) ? view.picks : []
  const rounds = Array.isArray(view.rounds) ? view.rounds : []
  const totalSeries = series.length
  const pickCount = activeEntry?.pickCount ?? picks.length
  const canSubmit = Boolean(activeEntry) && totalSeries > 0 && pickCount >= totalSeries

  if (!activeEntry) {
    return null
  }

  function handlePick(seriesId: string, teamName: string) {
    const entryId = activeEntry.id
    const wasSubmitted = Boolean(view.activeEntry?.isComplete)
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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save pick")
      }
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

      <LiveSeriesTicker series={series} />
      <PlayoffBracketBoard rounds={rounds} series={series} picks={picks} onPick={handlePick} />
    </div>
  )
}