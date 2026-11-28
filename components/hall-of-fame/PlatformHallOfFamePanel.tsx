"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"
import { StoryAiLockNotice, type StoryAiLock } from "@/components/league-story-ai/StoryAiLockNotice"

type EntryRow = {
  id: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  season: string | null
  category: string
  title: string
  summary: string | null
  inductedAt: string
  score: number
}

type MomentRow = {
  id: string
  leagueId: string
  sport: string
  season: string
  headline: string
  summary: string | null
  significanceScore: number
  createdAt: string
}

const CATEGORIES = [
  "all_time_great_managers",
  "all_time_great_teams",
  "greatest_moments",
  "biggest_upsets",
  "best_championship_runs",
  "longest_dynasties",
  "historic_comebacks",
  "iconic_rivalries",
] as const

export default function PlatformHallOfFamePanel() {
  const [sport, setSport] = useState<string>("")
  const [leagueId, setLeagueId] = useState<string>("")
  const [season, setSeason] = useState<string>("")
  const [category, setCategory] = useState<string>("")
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [moments, setMoments] = useState<MomentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [storyId, setStoryId] = useState<string | null>(null)
  const [story, setStory] = useState<string | null>(null)
  const [storyLock, setStoryLock] = useState<StoryAiLock>(null)

  const params = useMemo(() => {
    const qp = new URLSearchParams()
    if (sport) qp.set("sport", normalizeToSupportedSport(sport))
    if (leagueId.trim()) qp.set("leagueId", leagueId.trim())
    if (season.trim()) qp.set("season", season.trim())
    if (category) qp.set("category", category)
    qp.set("limit", "60")
    return qp.toString()
  }, [sport, leagueId, season, category])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [entryRes, momentRes] = await Promise.all([
        fetch(`/api/hall-of-fame/entries?${params}`, { cache: "no-store" }),
        fetch(`/api/hall-of-fame/moments?${params}`, { cache: "no-store" }),
      ])
      const entryData = await entryRes.json().catch(() => ({}))
      const momentData = await momentRes.json().catch(() => ({}))
      if (!entryRes.ok) throw new Error(entryData?.error ?? "Failed to load Hall of Fame entries")
      if (!momentRes.ok) throw new Error(momentData?.error ?? "Failed to load Hall of Fame moments")
      setEntries(Array.isArray(entryData?.entries) ? entryData.entries : [])
      setMoments(Array.isArray(momentData?.moments) ? momentData.moments : [])
    } catch (e: any) {
      setEntries([])
      setMoments([])
      setError(e?.message ?? "Failed to load platform Hall of Fame")
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function tellStory(type: "entry" | "moment", id: string, linkedLeagueId?: string | null) {
    setStoryLock(null)
    if (!linkedLeagueId) {
      setStoryId(id)
      setStory("This record is available in the platform timeline. Open the league context for full narrative details.")
      return
    }
    setStoryId(id)
    setStory(null)
    const res = await fetch(`/api/leagues/${encodeURIComponent(linkedLeagueId)}/hall-of-fame/tell-story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id }),
    })
    const data = await res.json().catch(() => ({}))
    setStory(data?.narrative ?? data?.error ?? "No narrative available.")
    // The linked league's commissioner plan decides; the fact-built narrative is shown either way.
    setStoryLock(data?.aiLocked ?? null)
  }

  return (
    <main className="space-y-4 p-4">
      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h1 className="text-lg font-semibold text-white">Platform Hall of Fame</h1>
        <p className="mt-1 text-xs text-white/65">
          Cross-league view of inducted entries and historic moments across supported sports.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            data-testid="platform-hof-sport-filter"
          >
            <option value="">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s === "NCAAB" ? "NCAA Basketball" : s === "NCAAF" ? "NCAA Football" : s}
              </option>
            ))}
          </select>
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            placeholder="League ID (optional)"
            data-testid="platform-hof-league-filter"
          />
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            placeholder="Season (optional)"
            data-testid="platform-hof-season-filter"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-white/20 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            data-testid="platform-hof-category-filter"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            onClick={() => void refresh()}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/15"
            data-testid="platform-hof-refresh"
          >
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {loading && <p className="text-sm text-white/60">Loading Hall of Fame data...</p>}

      {!loading && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-white">Inductions ({entries.length})</h2>
            <div className="mt-2 space-y-2">
              {entries.slice(0, 30).map((entry) => (
                <article key={entry.id} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3 text-xs">
                  <p className="font-medium text-white">{entry.title}</p>
                  <p className="text-white/60">
                    {entry.category.replace(/_/g, " ")} · {entry.sport}
                    {entry.season ? ` · ${entry.season}` : ""}
                  </p>
                  <p className="mt-1 text-white/70">{entry.summary ?? "No summary provided."}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.leagueId && (
                      <Link
                        href={`/league/${encodeURIComponent(entry.leagueId)}?tab=Hall of Fame`}
                        className="text-amber-300 hover:underline"
                      >
                        Open league HoF
                      </Link>
                    )}
                    {entry.leagueId && (
                      <Link
                        href={`/app/league/${encodeURIComponent(entry.leagueId)}/hall-of-fame/entries/${entry.id}`}
                        className="text-cyan-300 hover:underline"
                      >
                        Why inducted?
                      </Link>
                    )}
                    <button
                      type="button"
                      className="text-cyan-300 hover:underline"
                      onClick={() => void tellStory("entry", entry.id, entry.leagueId)}
                      data-testid={`platform-hof-entry-story-${entry.id}`}
                    >
                      Tell me why this matters
                    </button>
                  </div>
                </article>
              ))}
              {entries.length === 0 && <p className="text-sm text-white/55">No entries for this filter scope.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-sm font-semibold text-white">Moment Timeline ({moments.length})</h2>
            <div className="mt-2 space-y-2">
              {moments.slice(0, 30).map((moment) => (
                <article key={moment.id} className="rounded-lg border border-white/10 bg-zinc-950/70 p-3 text-xs">
                  <p className="font-medium text-white">{moment.headline}</p>
                  <p className="text-white/60">
                    {moment.sport} · {moment.season} · Significance {moment.significanceScore.toFixed(2)}
                  </p>
                  <p className="mt-1 text-white/70">{moment.summary ?? "No summary provided."}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={`/league/${encodeURIComponent(moment.leagueId)}?tab=Hall of Fame`}
                      className="text-amber-300 hover:underline"
                    >
                      Open league HoF
                    </Link>
                    <Link
                      href={`/app/league/${encodeURIComponent(moment.leagueId)}/hall-of-fame/moments/${moment.id}`}
                      className="text-cyan-300 hover:underline"
                    >
                      Why inducted?
                    </Link>
                    <button
                      type="button"
                      className="text-cyan-300 hover:underline"
                      onClick={() => void tellStory("moment", moment.id, moment.leagueId)}
                      data-testid={`platform-hof-moment-story-${moment.id}`}
                    >
                      Tell me why this matters
                    </button>
                  </div>
                </article>
              ))}
              {moments.length === 0 && <p className="text-sm text-white/55">No moments for this filter scope.</p>}
            </div>
          </div>
        </section>
      )}

      {storyId && story && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-medium">Narrative ({storyId})</p>
          <p className="mt-1">{story}</p>
          <StoryAiLockNotice lock={storyLock} featureName="Chimmy Hall of Fame write-ups" className="mt-2" />
        </section>
      )}
    </main>
  )
}
