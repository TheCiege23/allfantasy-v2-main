"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { StoryAiLockNotice, type StoryAiLock } from "@/components/league-story-ai/StoryAiLockNotice"

type RivalryDetail = {
  id: string
  leagueId: string
  sport: string
  sportLabel: string
  managerAId: string
  managerBId: string
  rivalryScore: number
  rivalryTier: string
  tierBadgeColor: string
  firstDetectedAt: string
  updatedAt: string
  eventCount?: number
  linkedDramaCount?: number
  linkedDramaEventIds?: string[]
}

type RivalryTimelineRow = {
  eventId: string
  eventType: string
  season: number | null
  matchupId: string | null
  tradeId: string | null
  description: string | null
  createdAt: string
}

type HeadToHeadRow = {
  matchupId: string
  season: number | null
  weekOrPeriod: number
  teamAId: string
  teamAName: string
  teamBId: string
  teamBName: string
  scoreA: number
  scoreB: number
  winnerTeamId: string | null
}

export default function RivalryDetailPage() {
  const params = useParams<{ leagueId: string; rivalryId: string }>() ?? ({} as { leagueId: string; rivalryId: string })
  const searchParams = useSearchParams()
  const leagueId = params?.leagueId ?? ""
  const rivalryId = params?.rivalryId ?? ""
  const sportFromQuery = searchParams?.get("sport") ?? ""
  const seasonFromQuery = searchParams?.get("season") ?? ""
  const [tab, setTab] = useState<"timeline" | "h2h">(
    searchParams?.get("tab") === "h2h" ? "h2h" : "timeline"
  )
  const [seasonFilter, setSeasonFilter] = useState<string>(seasonFromQuery)
  const [detail, setDetail] = useState<RivalryDetail | null>(null)
  const [timeline, setTimeline] = useState<RivalryTimelineRow[]>([])
  const [headToHead, setHeadToHead] = useState<HeadToHeadRow[]>([])
  const [aiNarrative, setAiNarrative] = useState<string | null>(null)
  const [aiLock, setAiLock] = useState<StoryAiLock>(null)
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)

  const seasonOptions = useMemo(() => {
    const seasons = new Set<number>()
    for (const row of timeline) if (row.season != null) seasons.add(row.season)
    for (const row of headToHead) if (row.season != null) seasons.add(row.season)
    return [...seasons].sort((a, b) => b - a)
  }, [timeline, headToHead])

  const loadDetail = async () => {
    if (!leagueId || !rivalryId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(rivalryId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) throw new Error("Failed to load rivalry detail")
      const data = await res.json()
      setDetail(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rivalry detail")
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  const loadTabData = async (targetTab: "timeline" | "h2h") => {
    if (!leagueId || !rivalryId) return
    setTabLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (seasonFilter) params.set("season", seasonFilter)
      const query = params.toString()
      if (targetTab === "timeline") {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(
            rivalryId
          )}/timeline${query ? `?${query}` : ""}`,
          { cache: "no-store" }
        )
        if (!res.ok) throw new Error("Failed to load timeline")
        const data = await res.json().catch(() => ({}))
        setTimeline(Array.isArray(data.timeline) ? data.timeline : [])
      } else {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(
            rivalryId
          )}/head-to-head${query ? `?${query}` : ""}`,
          { cache: "no-store" }
        )
        if (!res.ok) throw new Error("Failed to load head-to-head history")
        const data = await res.json().catch(() => ({}))
        setHeadToHead(Array.isArray(data.history) ? data.history : [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tab data")
      if (targetTab === "timeline") setTimeline([])
      else setHeadToHead([])
    } finally {
      setTabLoading(false)
    }
  }

  const explain = async () => {
    if (!leagueId || !rivalryId) return
    setExplaining(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rivalries/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rivalryId }),
      })
      const data = await res.json().catch(() => ({}))
      setAiNarrative(data?.narrative ?? "No explanation available.")
      setAiLock(data?.aiLocked ?? null)
    } catch {
      setAiNarrative("Could not load rivalry explanation.")
    } finally {
      setExplaining(false)
    }
  }

  useEffect(() => {
    void loadDetail()
  }, [leagueId, rivalryId])

  useEffect(() => {
    void loadTabData(tab)
  }, [leagueId, rivalryId, tab, seasonFilter])

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 space-y-4">
      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-white">Rivalry Detail</h1>
            <p className="text-xs text-white/60">League: {leagueId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/league/${encodeURIComponent(leagueId)}?tab=Intelligence`}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Back to Intelligence
            </Link>
            <button
              type="button"
              onClick={() => {
                void loadDetail()
                void loadTabData(tab)
              }}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void explain()}
              disabled={explaining}
              className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {explaining ? "Explaining..." : "Explain this rivalry"}
            </button>
          </div>
        </div>
      </section>

      {loading && <p className="text-sm text-white/60">Loading rivalry detail...</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {!loading && detail && (
        <>
          <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-white/85">
                <span className="font-medium">{detail.managerAId}</span> vs{" "}
                <span className="font-medium">{detail.managerBId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-white/80">
                  {detail.sportLabel}
                </span>
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-200">
                  {detail.rivalryTier}
                </span>
                <span className="text-xs text-white/70">Score {detail.rivalryScore.toFixed(1)}</span>
              </div>
            </div>
            {aiNarrative && (
              <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-white/90">
                {aiNarrative}
              </div>
            )}
            <StoryAiLockNotice lock={aiLock} featureName="Chimmy rivalry write-ups" className="mt-3" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href={`/app/league/${encodeURIComponent(leagueId)}/drama?sport=${encodeURIComponent(
                  sportFromQuery || detail.sport
                )}${seasonFilter ? `&season=${encodeURIComponent(seasonFilter)}` : ""}&relatedManagerId=${encodeURIComponent(
                  detail.managerAId
                )}`}
                className="rounded border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
              >
                Open linked drama context
              </Link>
              <Link
                href={`/app/league/${encodeURIComponent(
                  leagueId
                )}/psychological-profiles/compare?managerAId=${encodeURIComponent(
                  detail.managerAId
                )}&managerBId=${encodeURIComponent(detail.managerBId)}&sport=${encodeURIComponent(
                  sportFromQuery || detail.sport
                )}`}
                className="rounded border border-purple-500/25 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200 hover:bg-purple-500/20"
              >
                Open manager behavior context
              </Link>
              {detail.linkedDramaEventIds?.[0] && (
                <Link
                  href={`/app/league/${encodeURIComponent(leagueId)}/drama/${encodeURIComponent(
                    detail.linkedDramaEventIds[0]
                  )}`}
                  className="rounded border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
                >
                  Open top linked storyline ({detail.linkedDramaCount ?? 1})
                </Link>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("timeline")}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  tab === "timeline"
                    ? "bg-white text-black"
                    : "border border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                }`}
              >
                Rivalry Timeline
              </button>
              <button
                type="button"
                onClick={() => setTab("h2h")}
                className={`rounded-lg px-3 py-1.5 text-xs ${
                  tab === "h2h"
                    ? "bg-white text-black"
                    : "border border-white/20 bg-white/5 text-white/80 hover:bg-white/10"
                }`}
              >
                Head-to-head History
              </button>
              <select
                value={seasonFilter}
                onChange={(e) => setSeasonFilter(e.target.value)}
                className="ml-auto rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white/80"
                aria-label="Rivalry season filter"
              >
                <option value="">All seasons</option>
                {seasonOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {tabLoading && <p className="text-sm text-white/60">Loading {tab}...</p>}

            {!tabLoading && tab === "timeline" && (
              <ul className="space-y-2">
                {timeline.length === 0 ? (
                  <li className="text-sm text-white/60">No timeline events found.</li>
                ) : (
                  timeline.map((e) => (
                    <li
                      key={e.eventId}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-white/80"
                    >
                      <span className="text-white/50">{e.eventType}</span>
                      {e.description ? ` — ${e.description}` : ""}
                      {e.season != null ? ` (Season ${e.season})` : ""}
                    </li>
                  ))
                )}
              </ul>
            )}

            {!tabLoading && tab === "h2h" && (
              <ul className="space-y-2">
                {headToHead.length === 0 ? (
                  <li className="text-sm text-white/60">No head-to-head matchups found.</li>
                ) : (
                  headToHead.map((m) => (
                    <li
                      key={m.matchupId}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-white/80"
                    >
                      Season {m.season ?? "?"}, Week {m.weekOrPeriod}: {m.teamAName} {m.scoreA.toFixed(1)} -{" "}
                      {m.teamBName} {m.scoreB.toFixed(1)}
                    </li>
                  ))
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}
