"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, BookOpen } from "lucide-react"
import { useUserTimezone } from "@/hooks/useUserTimezone"
import { StoryAiLockNotice, type StoryAiLock } from "@/components/league-story-ai/StoryAiLockNotice"

interface MomentDetail {
  id: string
  leagueId: string
  sport: string
  season: string
  headline: string
  summary: string | null
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId: string | null
  significanceScore: number
  createdAt: string
  relatedLegacy?: Record<
    string,
    {
      overallLegacyScore: number
      championshipScore: number
      playoffScore: number
      consistencyScore: number
      rivalryScore: number
      awardsScore: number
      dynastyScore: number
    }
  >
}

export default function HallOfFameMomentDetailPage() {
  const { formatDateInTimezone } = useUserTimezone()
  const params = useParams<{ leagueId: string; momentId: string }>() ?? ({} as { leagueId: string; momentId: string })
  const leagueId = params?.leagueId ?? ""
  const momentId = params?.momentId ?? ""
  const [moment, setMoment] = useState<MomentDetail | null>(null)
  const [whyInductedPrompt, setWhyInductedPrompt] = useState<string | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [narrativeLock, setNarrativeLock] = useState<StoryAiLock>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!leagueId || !momentId) return
    setLoading(true)
    setError(null)
    fetch(
      `/api/leagues/${encodeURIComponent(leagueId)}/hall-of-fame/moments/${encodeURIComponent(momentId)}`,
      { cache: "no-store" }
    )
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error ?? "Moment not found")
        return data
      })
      .then((data) => {
        if (data?.moment) {
          setMoment(data.moment)
          setWhyInductedPrompt(data?.whyInductedPrompt ?? null)
        } else {
          setError("Moment not found")
        }
      })
      .catch((e: any) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false))
  }, [leagueId, momentId])

  const tellStory = () => {
    if (!leagueId || !momentId) return
    setNarrative(null)
    setNarrativeLock(null)
    setNarrativeLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/hall-of-fame/tell-story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "moment", id: momentId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error ?? "Could not load explanation.")
        return data
      })
      .then((data) => {
        setNarrative(data?.narrative ?? "No explanation available.")
        // The fact-built narrative is shown either way; `aiLocked` says why Chimmy did not write it.
        setNarrativeLock(data?.aiLocked ?? null)
      })
      .catch(() => setNarrative("Could not load explanation."))
      .finally(() => setNarrativeLoading(false))
  }

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-sm text-white/50">Loading moment…</p>
      </div>
    )
  }

  if (error || !moment) {
    return (
      <div className="space-y-4 p-4">
        <Link
          href={`/league/${leagueId}?tab=Hall of Fame`}
          className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Hall of Fame
        </Link>
        <p className="text-red-300">{error ?? "Moment not found"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 max-w-2xl">
      <Link
        href={`/league/${leagueId}?tab=Hall of Fame`}
        className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Hall of Fame
      </Link>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
        <h1 className="text-lg font-bold text-white">{moment.headline}</h1>
        <div className="text-xs text-zinc-400">
          {moment.sport} · {moment.season} · Significance:{" "}
          {moment.significanceScore.toFixed(2)}
        </div>
        {moment.summary && (
          <p className="text-sm text-zinc-300">{moment.summary}</p>
        )}
        <p className="text-xs text-zinc-500">
          Recorded: {formatDateInTimezone(moment.createdAt)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={narrativeLoading}
            onClick={tellStory}
          >
            <BookOpen className="h-4 w-4" />
            {narrativeLoading ? "Loading…" : "Tell me why this matters"}
          </button>
        </div>

        {moment.relatedManagerIds.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
            <p className="text-xs font-semibold text-zinc-400 mb-2">Related managers · Legacy</p>
            <div className="flex flex-wrap gap-2">
              {moment.relatedManagerIds.map((managerId) => (
                <Link
                  key={managerId}
                  href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=MANAGER&entityId=${encodeURIComponent(managerId)}&sport=${encodeURIComponent(moment.sport)}`}
                  className="text-xs text-amber-400 hover:underline"
                >
                  {managerId} — legacy
                  {moment.relatedLegacy?.[managerId]?.overallLegacyScore != null
                    ? ` (${moment.relatedLegacy[managerId].overallLegacyScore.toFixed(1)})`
                    : ""}
                </Link>
              ))}
            </div>
          </div>
        )}
        {moment.relatedTeamIds.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
            <p className="text-xs font-semibold text-zinc-400 mb-2">Related teams · Legacy</p>
            <div className="flex flex-wrap gap-2">
              {moment.relatedTeamIds.map((teamId) => (
                <Link
                  key={teamId}
                  href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=TEAM&entityId=${encodeURIComponent(teamId)}&sport=${encodeURIComponent(moment.sport)}`}
                  className="text-xs text-amber-400 hover:underline"
                >
                  {teamId} — legacy
                </Link>
              ))}
            </div>
          </div>
        )}

        {narrative && (
          <div className="rounded-lg bg-zinc-900 p-3 text-sm text-zinc-300 border border-zinc-700">
            {narrative}
          </div>
        )}
        {narrative && <StoryAiLockNotice lock={narrativeLock} featureName="Chimmy Hall of Fame write-ups" />}
        {whyInductedPrompt && (
          <details className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3 text-xs text-zinc-300">
            <summary className="cursor-pointer text-zinc-200">Induction evidence prompt context</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-zinc-400">
              {whyInductedPrompt}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
