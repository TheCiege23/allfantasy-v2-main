'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { DRAMA_TYPES } from '@/lib/drama-engine/types'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

type DramaRow = {
  id: string
  dramaType: string
  headline: string
  summary: string | null
  dramaScore: number
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId: string | null
}

const PAGE_LIMIT = 10

export default function LeagueDramaDashboardPage() {
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const searchParams = useSearchParams()
  const leagueId = params?.leagueId ?? ''
  const sportFromQuery = searchParams?.get('sport')
  const seasonFromQuery = searchParams?.get('season')
  const dramaTypeFromQuery = searchParams?.get('dramaType')
  const minScoreFromQuery = searchParams?.get('minScore')
  const relatedManagerFromQuery = searchParams?.get('relatedManagerId')
  const currentYear = new Date().getFullYear()
  const [sportFilter, setSportFilter] = useState<string>(sportFromQuery ?? 'ALL')
  const [seasonFilter, setSeasonFilter] = useState<string>(seasonFromQuery ?? String(currentYear))
  const [dramaTypeFilter, setDramaTypeFilter] = useState<string>(dramaTypeFromQuery ?? 'ALL')
  const [minScoreFilter, setMinScoreFilter] = useState<string>(minScoreFromQuery ?? '0')
  const [relatedManagerFilter, setRelatedManagerFilter] = useState<string>(relatedManagerFromQuery ?? '')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<DramaRow[]>([])
  const [storyByEvent, setStoryByEvent] = useState<Record<string, string>>({})
  const [storyLoadingId, setStoryLoadingId] = useState<string | null>(null)

  const canPrev = offset > 0
  const canNext = timeline.length === PAGE_LIMIT

  const query = useMemo(() => {
    const p = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    })
    if (sportFilter !== 'ALL') p.set('sport', sportFilter)
    const seasonNum = Number(seasonFilter)
    if (!Number.isNaN(seasonNum) && seasonNum > 0) p.set('season', String(seasonNum))
    if (dramaTypeFilter !== 'ALL') p.set('dramaType', dramaTypeFilter)
    const minScoreNum = Number(minScoreFilter)
    if (!Number.isNaN(minScoreNum) && minScoreNum > 0) p.set('minScore', String(minScoreNum))
    if (relatedManagerFilter.trim()) p.set('relatedManagerId', relatedManagerFilter.trim())
    return p
  }, [sportFilter, seasonFilter, dramaTypeFilter, minScoreFilter, relatedManagerFilter, offset])

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/drama/timeline?${query.toString()}`,
        { cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load drama timeline')
      setTimeline(Array.isArray(data?.timeline) ? data.timeline : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drama timeline')
      setTimeline([])
    } finally {
      setLoading(false)
    }
  }, [leagueId, query])

  const runEngine = useCallback(async () => {
    if (!leagueId) return
    setRunning(true)
    setError(null)
    try {
      const seasonNum = Number(seasonFilter)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(sportFilter !== 'ALL' ? { sport: sportFilter } : {}),
          ...(!Number.isNaN(seasonNum) && seasonNum > 0 ? { season: seasonNum } : {}),
          replace: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to run drama engine')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run drama engine')
    } finally {
      setRunning(false)
    }
  }, [leagueId, sportFilter, seasonFilter, load])

  const tellStory = useCallback(
    async (eventId: string) => {
      if (storyByEvent[eventId]) {
        setStoryByEvent((prev) => {
          const next = { ...prev }
          delete next[eventId]
          return next
        })
        return
      }
      setStoryLoadingId(eventId)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/tell-story`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
        })
        const data = await res.json().catch(() => ({}))
        setStoryByEvent((prev) => ({
          ...prev,
          [eventId]: data?.narrative ?? 'No story available.',
        }))
      } catch {
        setStoryByEvent((prev) => ({
          ...prev,
          [eventId]: 'Could not load story.',
        }))
      } finally {
        setStoryLoadingId(null)
      }
    },
    [leagueId, storyByEvent]
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 space-y-4">
      <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-amber-100">League Drama Timeline</h1>
            <p className="text-xs text-white/60">
              Ranked storylines with filters, timeline navigation, and AI story summaries.
            </p>
          </div>
          <Link
            href={`/league/${encodeURIComponent(leagueId)}`}
            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to league
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="grid gap-2 md:grid-cols-5">
          <select
            value={sportFilter}
            onChange={(e) => {
              setOffset(0)
              setSportFilter(e.target.value)
            }}
            className="rounded border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs text-white/80"
            aria-label="Drama sport filter"
          >
            <option value="ALL">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s === 'NCAAB' ? 'NCAA Basketball' : s === 'NCAAF' ? 'NCAA Football' : s}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={seasonFilter}
            onChange={(e) => {
              setOffset(0)
              setSeasonFilter(e.target.value)
            }}
            className="rounded border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs text-white/80"
            aria-label="Drama season filter"
            placeholder="Season"
          />
          <select
            value={dramaTypeFilter}
            onChange={(e) => {
              setOffset(0)
              setDramaTypeFilter(e.target.value)
            }}
            className="rounded border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs text-white/80"
            aria-label="Drama type filter"
          >
            <option value="ALL">All drama types</option>
            {DRAMA_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={minScoreFilter}
            onChange={(e) => {
              setOffset(0)
              setMinScoreFilter(e.target.value)
            }}
            className="rounded border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs text-white/80"
            aria-label="Drama minimum score filter"
            placeholder="Min score"
          />
          <input
            type="text"
            value={relatedManagerFilter}
            onChange={(e) => {
              setOffset(0)
              setRelatedManagerFilter(e.target.value)
            }}
            className="rounded border border-white/20 bg-black/40 px-2.5 py-1.5 text-xs text-white/80"
            aria-label="Drama related manager filter"
            placeholder="Related manager id"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runEngine()}
            disabled={running}
            className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Refresh storylines'}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
          >
            Reload timeline
          </button>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => setOffset((v) => Math.max(0, v - PAGE_LIMIT))}
            className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:opacity-40"
          >
            Prev page
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setOffset((v) => v + PAGE_LIMIT)}
            className="rounded border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10 disabled:opacity-40"
          >
            Next page
          </button>
          <span className="text-xs text-white/45">Offset {offset}</span>
        </div>
      </section>

      {loading && <p className="text-sm text-white/60">Loading storyline timeline…</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {!loading && !error && timeline.length === 0 && (
        <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/60">
          No storyline events found for the current filters.
        </p>
      )}

      <section className="space-y-2">
        {timeline.map((event) => (
          <article key={event.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-200">
                {event.dramaType}
              </span>
              <span className="text-[11px] text-white/45">Score {Math.round(event.dramaScore)}</span>
              <span className="text-[11px] text-white/45">
                Teams {event.relatedTeamIds.length} · Managers {event.relatedManagerIds.length}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void tellStory(event.id)}
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/25 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/15"
                >
                  <BookOpen className="h-3 w-3" />
                  {storyLoadingId === event.id ? 'Loading…' : storyByEvent[event.id] ? 'Hide story' : 'Tell me the story'}
                </button>
                <Link
                  href={`/app/league/${encodeURIComponent(leagueId)}/drama/${encodeURIComponent(event.id)}`}
                  className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/75 hover:bg-white/10"
                >
                  Story detail
                </Link>
              </div>
            </div>
            <p className="mt-1 text-sm text-white/85">{event.headline}</p>
            {event.summary && <p className="mt-1 text-xs text-white/60">{event.summary}</p>}
            {storyByEvent[event.id] && (
              <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/75">{storyByEvent[event.id]}</p>
            )}
          </article>
        ))}
      </section>
    </main>
  )
}
