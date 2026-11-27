"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useHallOfFame } from "@/hooks/useHallOfFame"
import { useHallOfFameEntriesAndMoments } from "@/hooks/useHallOfFameEntriesAndMoments"
import { HallOfFameCard } from "@/components/HallOfFameCard"
import { SeasonLeaderboardCard } from "@/components/rankings/SeasonLeaderboardCard"
import type { HallOfFameEntryRow, HallOfFameMomentRow } from "@/hooks/useHallOfFameEntriesAndMoments"
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from "@/lib/sport-scope"
import { StoryAiLockNotice, type StoryAiLock } from "@/components/league-story-ai/StoryAiLockNotice"

const HOF_SPORTS = [...SUPPORTED_SPORTS]
const HOF_CATEGORIES = [
  "all_time_great_managers",
  "all_time_great_teams",
  "greatest_moments",
  "biggest_upsets",
  "best_championship_runs",
  "longest_dynasties",
  "historic_comebacks",
  "iconic_rivalries",
] as const
const HOF_ENTITY_TYPES = [
  "MANAGER",
  "TEAM",
  "MOMENT",
  "DYNASTY_RUN",
  "CHAMPIONSHIP_RUN",
  "RECORD_SEASON",
] as const

export function HallOfFameSection(props: {
  leagueId: string
  seasons: string[]
  defaultSeason?: string
}) {
  const normalizedSeasons = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of props.seasons ?? []) {
      const v = String(s)
      if (!seen.has(v)) {
        seen.add(v)
        out.push(v)
      }
    }
    return out
  }, [props.seasons])

  const initialSeason =
    props.defaultSeason && normalizedSeasons.includes(props.defaultSeason)
      ? props.defaultSeason
      : normalizedSeasons?.[0] ?? ""

  const [season, setSeason] = useState<string>(initialSeason)
  const [sportFilter, setSportFilter] = useState<string>("")
  const [categoryFilter, setCategoryFilter] = useState<string>("")
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("")
  const [timelineSort, setTimelineSort] = useState<"significance" | "recent">("significance")
  const [storyId, setStoryId] = useState<string | null>(null)
  const [storyNarrative, setStoryNarrative] = useState<string | null>(null)
  const [storyLoading, setStoryLoading] = useState<string | null>(null)
  const [storyError, setStoryError] = useState<string | null>(null)
  const [storyAiLock, setStoryAiLock] = useState<StoryAiLock>(null)
  const [syncMomentsLoading, setSyncMomentsLoading] = useState(false)
  const [engineLoading, setEngineLoading] = useState(false)
  const [engineSummary, setEngineSummary] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (props.defaultSeason && normalizedSeasons.includes(props.defaultSeason)) {
      setSeason(props.defaultSeason)
    } else if (!season && normalizedSeasons.length) {
      setSeason(normalizedSeasons[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.defaultSeason, normalizedSeasons])

  const { hofRows, seasonRows, loading, error, meta, rebuild } = useHallOfFame({
    leagueId: props.leagueId,
    season: season || null,
  })

  const {
    entries,
    moments,
    entriesTotal,
    momentsTotal,
    loading: entriesMomentsLoading,
    error: entriesMomentsError,
    refresh: refreshEntriesMoments,
  } = useHallOfFameEntriesAndMoments({
    leagueId: props.leagueId,
    sport: sportFilter || null,
    season: season || null,
    category: categoryFilter || null,
    entityType: entityTypeFilter || null,
  })

  const tellStory = useCallback(
    async (type: "entry" | "moment", id: string) => {
      if (storyId === id && storyNarrative !== null) {
        setStoryId(null)
        setStoryNarrative(null)
        setStoryLoading(null)
        setStoryError(null)
        return
      }
      setStoryId(id)
      setStoryNarrative(null)
      setStoryLoading(id)
      setStoryError(null)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(props.leagueId)}/hall-of-fame/tell-story`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, id }),
          }
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? "Could not build Hall of Fame story")
        setStoryNarrative(data?.narrative ?? "No explanation available.")
        // The fact-built narrative is shown either way; `aiLocked` says why Chimmy did not write it.
        setStoryAiLock(data?.aiLocked ?? null)
      } catch (e: any) {
        setStoryNarrative("Could not load explanation.")
        setStoryError(e?.message ?? "Could not load explanation.")
      } finally {
        setStoryLoading(null)
      }
    },
    [props.leagueId, storyId, storyNarrative]
  )

  const syncMoments = useCallback(async () => {
    setSyncMomentsLoading(true)
    setActionError(null)
    setEngineSummary(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(props.leagueId)}/hall-of-fame/sync-moments`,
        { method: "POST" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Unable to sync Hall of Fame moments")
      await refreshEntriesMoments()
      setEngineSummary(`Synced moments: ${data?.created ?? 0} created.`)
    } catch (e: any) {
      setActionError(e?.message ?? "Unable to sync Hall of Fame moments")
    } finally {
      setSyncMomentsLoading(false)
    }
  }, [props.leagueId, refreshEntriesMoments])

  const runHallOfFameEngine = useCallback(async () => {
    setEngineLoading(true)
    setActionError(null)
    setEngineSummary(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(props.leagueId)}/hall-of-fame/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sport: sportFilter ? normalizeToSupportedSport(sportFilter) : undefined,
            maxSeasons: 12,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? "Unable to run Hall of Fame engine")
      await Promise.all([refreshEntriesMoments(), rebuild()])
      setEngineSummary(
        `Engine complete: ${data?.entriesCreated ?? 0} entries created, ${data?.entriesUpdated ?? 0} updated, ${data?.momentsCreated ?? 0} moments created.`
      )
    } catch (e: any) {
      setActionError(e?.message ?? "Unable to run Hall of Fame engine")
    } finally {
      setEngineLoading(false)
    }
  }, [props.leagueId, rebuild, refreshEntriesMoments, sportFilter])

  const momentsTimeline = useMemo(() => {
    const rows = [...moments]
    if (timelineSort === "recent") {
      rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else {
      rows.sort((a, b) => b.significanceScore - a.significanceScore)
    }
    return rows
  }, [moments, timelineSort])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-zinc-900 p-4 flex items-center justify-between">
        <div>
          <div className="font-bold">Hall of Fame</div>
          <div className="text-xs opacity-70">
            League and platform Hall of Fame: all-time leaderboard, inductions, and moments timeline.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            aria-label="Hall of Fame season filter"
            data-testid="hof-season-filter"
          >
            {normalizedSeasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <button
            className="rounded-xl bg-white text-black px-4 py-2 font-bold disabled:opacity-60"
            disabled={loading}
            onClick={() => rebuild()}
            data-testid="hof-rebuild"
          >
            Rebuild
          </button>
          <button
            className="rounded-xl bg-amber-600 text-white px-4 py-2 font-bold disabled:opacity-60"
            disabled={engineLoading}
            onClick={() => runHallOfFameEngine()}
            data-testid="hof-run-engine"
          >
            {engineLoading ? "Running…" : "Run HoF engine"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl bg-zinc-950 p-3 text-sm opacity-80">Error: {error}</div>
      ) : null}

      {meta?.fallbackMode && (
        <div className="rounded-2xl bg-yellow-900/20 border border-yellow-700/30 px-4 py-3 text-yellow-300 text-xs">
          {meta.rankingSourceNote}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <HallOfFameCard rows={hofRows} />
        <SeasonLeaderboardCard season={season} rows={seasonRows} />
      </div>

      {/* Inductions & Moments */}
      <div className="rounded-2xl bg-zinc-900 p-4 space-y-4 border border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold">Inductions & Moments</div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={sportFilter}
              onChange={(e) =>
                setSportFilter(e.target.value ? normalizeToSupportedSport(e.target.value) : "")
              }
              aria-label="Hall of Fame sport filter"
              data-testid="hof-sport-filter"
            >
              <option value="">All sports</option>
              {HOF_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s === "NCAAB" ? "NCAA Basketball" : s === "NCAAF" ? "NCAA Football" : s}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Hall of Fame category filter"
              data-testid="hof-category-filter"
            >
              <option value="">All categories</option>
              {HOF_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              aria-label="Hall of Fame entity type filter"
              data-testid="hof-entity-type-filter"
            >
              <option value="">All entity types</option>
              {HOF_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm"
              value={timelineSort}
              onChange={(e) =>
                setTimelineSort(e.target.value === "recent" ? "recent" : "significance")
              }
              aria-label="Hall of Fame timeline sort"
              data-testid="hof-timeline-sort"
            >
              <option value="significance">Timeline by significance</option>
              <option value="recent">Timeline by recency</option>
            </select>
            <button
              type="button"
              className="rounded-xl bg-zinc-700 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={entriesMomentsLoading}
              onClick={() => refreshEntriesMoments()}
              data-testid="hof-refresh"
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-xl bg-amber-600 text-white px-3 py-2 text-sm disabled:opacity-60"
              disabled={syncMomentsLoading}
              onClick={syncMoments}
              data-testid="hof-sync-moments"
            >
              {syncMomentsLoading ? "Syncing…" : "Sync moments"}
            </button>
            <Link
              href="/app/hall-of-fame"
              className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-sm hover:bg-white/15"
            >
              Platform Hall of Fame
            </Link>
          </div>
        </div>

        {actionError && (
          <div className="rounded-xl bg-zinc-950 p-3 text-sm text-red-300">{actionError}</div>
        )}
        {engineSummary && (
          <div className="rounded-xl bg-zinc-950 p-3 text-sm text-emerald-300">{engineSummary}</div>
        )}

        {entriesMomentsError && (
          <div className="rounded-xl bg-zinc-950 p-3 text-sm text-red-300">
            {entriesMomentsError}
          </div>
        )}

        {entriesMomentsLoading && (
          <div className="text-sm text-zinc-400">Loading inductions and moments…</div>
        )}

        {!entriesMomentsLoading && (entries.length > 0 || moments.length > 0) && (
          <>
            {entries.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-300">
                  Inductions ({entriesTotal})
                </h3>
                <div className="space-y-2">
                  {entries.slice(0, 15).map((e) => (
                    <HallOfFameEntryCard
                      key={e.id}
                      entry={e}
                      leagueId={props.leagueId}
                      storyId={storyId}
                      storyNarrative={storyNarrative}
                      storyLoading={storyLoading}
                      onTellStory={() => tellStory("entry", e.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {moments.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-300">
                  Moments timeline ({momentsTotal})
                </h3>
                <div className="space-y-2">
                  {momentsTimeline.slice(0, 15).map((m) => (
                    <HallOfFameMomentCard
                      key={m.id}
                      moment={m}
                      leagueId={props.leagueId}
                      storyId={storyId}
                      storyNarrative={storyNarrative}
                      storyLoading={storyLoading}
                      onTellStory={() => tellStory("moment", m.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!entriesMomentsLoading && entries.length === 0 && moments.length === 0 && (
          <p className="text-sm text-zinc-500">
            No inductions or moments yet. Use &quot;Sync moments&quot; to detect championships
            and record seasons from league history.
          </p>
        )}
        {storyId && <StoryAiLockNotice lock={storyAiLock} featureName="Chimmy Hall of Fame write-ups" />}
        {storyError && storyId && (
          <p className="text-xs text-red-300">Story error: {storyError}</p>
        )}

        <p className="text-xs text-zinc-500 mt-2">
          Legacy scores (championships, playoffs, consistency) are in the{" "}
          <Link
            href={`/league/${encodeURIComponent(props.leagueId)}?tab=Legacy`}
            className="text-amber-400 hover:underline font-medium"
          >
            Legacy
          </Link>{" "}
          tab. Trust scores:{" "}
          <Link
            href={`/league/${encodeURIComponent(props.leagueId)}?tab=Settings&settingsTab=${encodeURIComponent("Reputation")}`}
            className="text-cyan-400 hover:underline"
          >
            Settings → Reputation
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

function HallOfFameEntryCard({
  entry,
  leagueId,
  storyId,
  storyNarrative,
  storyLoading,
  onTellStory,
}: {
  entry: HallOfFameEntryRow
  leagueId: string
  storyId: string | null
  storyNarrative: string | null
  storyLoading: string | null
  onTellStory: () => void
}) {
  return (
    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-semibold text-white">{entry.title}</div>
          <div className="text-xs text-zinc-400">
            {entry.category.replace(/_/g, " ")} · {entry.sport}
            {entry.season ? ` · ${entry.season}` : ""}
          </div>
          {entry.summary && (
            <p className="text-sm text-zinc-500 mt-1">{entry.summary}</p>
          )}
        </div>
        <div className="text-xs font-mono text-amber-400 shrink-0">
          {entry.score.toFixed(2)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href={`/app/league/${encodeURIComponent(leagueId)}/hall-of-fame/entries/${entry.id}`}
          className="text-xs text-amber-400 hover:underline"
          data-testid={`hof-entry-detail-${entry.id}`}
        >
          Why inducted?
        </Link>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline disabled:opacity-50"
          disabled={storyLoading === entry.id}
          onClick={onTellStory}
          data-testid={`hof-entry-story-${entry.id}`}
        >
          {storyLoading === entry.id
            ? "…"
            : storyId === entry.id && storyNarrative
              ? "Hide"
              : "Tell me why this matters"}
        </button>
      </div>
      {storyId === entry.id && storyNarrative && (
        <div className="mt-2 p-2 rounded-lg bg-zinc-900 text-sm text-zinc-300">
          {storyNarrative}
        </div>
      )}
    </div>
  )
}

function HallOfFameMomentCard({
  moment,
  leagueId,
  storyId,
  storyNarrative,
  storyLoading,
  onTellStory,
}: {
  moment: HallOfFameMomentRow
  leagueId: string
  storyId: string | null
  storyNarrative: string | null
  storyLoading: string | null
  onTellStory: () => void
}) {
  return (
    <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-semibold text-white">{moment.headline}</div>
          <div className="text-xs text-zinc-400">
            {moment.sport} · {moment.season}
          </div>
          {moment.summary && (
            <p className="text-sm text-zinc-500 mt-1">{moment.summary}</p>
          )}
        </div>
        <div className="text-xs font-mono text-amber-400 shrink-0">
          {moment.significanceScore.toFixed(2)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href={`/app/league/${encodeURIComponent(leagueId)}/hall-of-fame/moments/${moment.id}`}
          className="text-xs text-amber-400 hover:underline"
          data-testid={`hof-moment-detail-${moment.id}`}
        >
          Why inducted?
        </Link>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline disabled:opacity-50"
          disabled={storyLoading === moment.id}
          onClick={onTellStory}
          data-testid={`hof-moment-story-${moment.id}`}
        >
          {storyLoading === moment.id
            ? "…"
            : storyId === moment.id && storyNarrative
              ? "Hide"
              : "Tell me why this matters"}
        </button>
      </div>
      {storyId === moment.id && storyNarrative && (
        <div className="mt-2 p-2 rounded-lg bg-zinc-900 text-sm text-zinc-300">
          {storyNarrative}
        </div>
      )}
    </div>
  )
}
