"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { ArrowLeft, BookOpen } from "lucide-react"
import { useUserTimezone } from "@/hooks/useUserTimezone"

interface BreakdownData {
  record: {
    id: string
    entityType: string
    entityId: string
    sport: string
    leagueId: string | null
    overallLegacyScore: number
    championshipScore: number
    playoffScore: number
    consistencyScore: number
    rivalryScore: number
    awardsScore: number
    dynastyScore: number
    updatedAt: string
  }
  breakdown: Record<string, number>
}

export default function LegacyBreakdownPage() {
  const { formatDateInTimezone } = useUserTimezone()
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const searchParams = useSearchParams()
  const leagueId = params?.leagueId ?? ""
  const entityType = searchParams?.get("entityType") ?? "MANAGER"
  const entityId = searchParams?.get("entityId") ?? ""
  const sport = searchParams?.get("sport") ?? undefined
  const [data, setData] = useState<BreakdownData | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!leagueId || !entityId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const ep = new URLSearchParams({
      entityType: String(entityType),
      entityId: String(entityId),
      ...(sport ? { sport: String(sport) } : {}),
    })
    const url = `/api/leagues/${encodeURIComponent(leagueId)}/legacy-score/breakdown?${ep.toString()}`
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const res = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(res?.error ?? "Failed to load")
        return res
      })
      .then((res) => {
        if (res?.record) setData(res)
        else setError(res?.error ?? "Not found")
      })
      .catch((e: any) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false))
  }, [leagueId, entityType, entityId, sport])

  const tellStory = () => {
    if (!leagueId || !entityId) return
    setNarrative(null)
    setNarrativeLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/legacy-score/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId, ...(sport ? { sport } : {}) }),
    })
      .then(async (r) => {
        const res = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(res?.message ?? res?.error ?? "Could not load explanation.")
        return res
      })
      .then((res) => setNarrative(res?.narrative ?? "No explanation available."))
      .catch((e: unknown) => setNarrative(e instanceof Error && e.message ? e.message : "Could not load explanation."))
      .finally(() => setNarrativeLoading(false))
  }

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-sm text-white/50">Loading score breakdown…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4 p-4">
        <Link
          href={`/league/${leagueId}?tab=Legacy`}
          className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Legacy
        </Link>
        <p className="text-red-300">{error ?? "Breakdown not found"}</p>
      </div>
    )
  }

  const { record, breakdown } = data
  const labels: Record<string, string> = {
    championshipScore: "Championships / Finals",
    playoffScore: "Playoff success",
    consistencyScore: "Consistency",
    rivalryScore: "Rivalry dominance",
    awardsScore: "Awards",
    dynastyScore: "Dynasty / Staying power",
  }

  return (
    <div className="space-y-4 p-4 max-w-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/league/${leagueId}?tab=Legacy`}
          className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Legacy
        </Link>
        <Link
          href={`/league/${leagueId}?tab=Legacy`}
          className="text-sm text-amber-400 hover:underline"
        >
          Legacy tab
        </Link>
        {record.entityType === "MANAGER" && (
          <>
            <Link
              href={`/league/${leagueId}?tab=Settings&settingsTab=${encodeURIComponent("Reputation")}`}
              className="text-sm text-cyan-400 hover:underline"
            >
              Trust (Reputation)
            </Link>
            <Link
              href={`/league/${leagueId}?tab=Hall of Fame`}
              className="text-sm text-amber-400 hover:underline"
            >
              Hall of Fame
            </Link>
          </>
        )}
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
        <h1 className="text-lg font-bold text-white">
          Legacy score breakdown — {record.entityType} {record.entityId}
        </h1>
        <p className="text-xs text-zinc-400">
          {record.sport} · Updated {formatDateInTimezone(record.updatedAt)}
        </p>
        <div className="text-2xl font-bold text-amber-400">
          Overall: {record.overallLegacyScore.toFixed(0)}
        </div>

        <div className="grid gap-2 text-sm">
          {Object.entries(breakdown).map(([key, value]) => (
            <div
              key={key}
              className="flex justify-between items-center rounded-lg bg-zinc-900/50 px-3 py-2"
            >
              <span className="text-zinc-300">{labels[key] ?? key}</span>
              <span className="font-mono text-amber-400">{value.toFixed(0)}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={narrativeLoading}
          onClick={tellStory}
        >
          <BookOpen className="h-4 w-4" />
          {narrativeLoading ? "Loading…" : "Why is this score high?"}
        </button>

        {narrative && (
          <div className="rounded-lg bg-zinc-900 p-3 text-sm text-zinc-300 border border-zinc-700">
            {narrative}
          </div>
        )}
      </div>
    </div>
  )
}
