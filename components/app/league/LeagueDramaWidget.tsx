'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Zap, BookOpen, ExternalLink } from 'lucide-react'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'

interface DramaEventItem {
  id: string
  dramaType: string
  headline: string
  summary: string | null
  dramaScore: number
  createdAt: string
}

const DRAMA_SPORTS = [...SUPPORTED_SPORTS]

export function LeagueDramaWidget({
  leagueId,
  sport: sportProp,
  season: seasonProp,
}: {
  leagueId: string
  sport?: string
  season?: number | null
}) {
  const currentYear = new Date().getFullYear()
  const [sport, setSport] = useState<string>(normalizeToSupportedSport(sportProp ?? DEFAULT_SPORT))
  const [season, setSeason] = useState<number | null>(seasonProp ?? currentYear)
  const [dramaTypeFilter, setDramaTypeFilter] = useState<string>('ALL')
  const [events, setEvents] = useState<DramaEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [storyEventId, setStoryEventId] = useState<string | null>(null)
  const [storyNarrative, setStoryNarrative] = useState<string | null>(null)
  const [storyLoading, setStoryLoading] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (sport) params.set('sport', sport)
    if (season != null) params.set('season', String(season))
    if (dramaTypeFilter !== 'ALL') params.set('dramaType', dramaTypeFilter)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama?${params}&limit=10`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setEvents(Array.isArray(data.events) ? data.events : []))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Error')
        setEvents([])
      })
      .finally(() => setLoading(false))
  }, [leagueId, sport, season, dramaTypeFilter])

  useEffect(() => {
    setSport(normalizeToSupportedSport(sportProp ?? DEFAULT_SPORT))
    setSeason(seasonProp ?? currentYear)
  }, [sportProp, seasonProp, currentYear])

  useEffect(() => {
    load()
  }, [load])

  const runEngine = useCallback(() => {
    setRunning(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sport: normalizeToSupportedSport(sport ?? DEFAULT_SPORT),
        season: season ?? new Date().getFullYear(),
        replace: true,
      }),
    })
      .then((r) => r.json())
      .then(() => load())
      .catch(() => setError('Run failed'))
      .finally(() => setRunning(false))
  }, [leagueId, sport, season, load])

  const tellStory = useCallback((eventId: string) => {
    if (storyEventId === eventId && storyNarrative !== null) {
      setStoryEventId(null)
      setStoryNarrative(null)
      setStoryLoading(null)
      return
    }
    setStoryEventId(eventId)
    setStoryNarrative(null)
    setStoryLoading(eventId)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/tell-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(
            typeof data?.message === 'string'
              ? data.message
              : typeof data?.error === 'string'
                ? data.error
                : 'Could not load story.'
          )
        }
        return data
      })
      .then((data) => {
        setStoryNarrative(data?.narrative ?? 'No story available.')
        setStoryLoading(null)
      })
      .catch((error) => {
        setStoryNarrative(error instanceof Error ? error.message : 'Could not load story.')
        setStoryLoading(null)
      })
  }, [leagueId, storyEventId, storyNarrative])

  if (loading) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm text-white/50">Loading storylines…</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
          <Zap className="h-4 w-4" />
          League drama
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 text-[11px] text-white"
            aria-label="Drama widget sport filter"
          >
            {DRAMA_SPORTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={season ?? ''}
            onChange={(e) => setSeason(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 text-[11px] text-white"
            aria-label="Drama widget season filter"
          >
            <option value="">All</option>
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={dramaTypeFilter}
            onChange={(e) => setDramaTypeFilter(e.target.value)}
            className="rounded border border-white/20 bg-black/40 px-1.5 py-0.5 text-[11px] text-white"
            aria-label="Drama widget type filter"
          >
            <option value="ALL">All types</option>
            <option value="RIVALRY_CLASH">RIVALRY_CLASH</option>
            <option value="MAJOR_UPSET">MAJOR_UPSET</option>
            <option value="TRADE_FALLOUT">TRADE_FALLOUT</option>
            <option value="PLAYOFF_BUBBLE">PLAYOFF_BUBBLE</option>
          </select>
          <button
            type="button"
            onClick={runEngine}
            disabled={running}
            className="rounded border border-amber-500/30 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
          >
            Reload
          </button>
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/drama`}
            className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
          >
            Timeline
          </Link>
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {events.length === 0 && !error && (
        <p className="text-xs text-white/50">No storylines yet. Click Refresh to generate from rivalries and matchups.</p>
      )}
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white/90 truncate">{e.headline}</p>
                {e.summary && <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2">{e.summary}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">{e.dramaType}</span>
                  <span className="text-[11px] text-white/40">Score: {e.dramaScore.toFixed(0)}</span>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => tellStory(e.id)}
                  className="flex items-center gap-0.5 rounded border border-cyan-500/25 px-1.5 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/15"
                  title="Tell me the story"
                >
                  <BookOpen className="h-3 w-3" />
                  Story
                </button>
                <Link
                  href={`/app/league/${leagueId}/drama/${e.id}`}
                  className="flex items-center gap-0.5 rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
                  title="View storyline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View
                </Link>
                {e.dramaType === 'TRADE_FALLOUT' && (
                  <Link
                    href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
                    className="rounded border border-purple-500/25 px-1.5 py-0.5 text-[11px] text-purple-200 hover:bg-purple-500/10"
                  >
                    Trade context
                  </Link>
                )}
              </div>
            </div>
            {storyEventId === e.id && storyLoading === e.id && (
              <p className="mt-2 text-[11px] text-white/50 border-t border-white/10 pt-2">Loading story…</p>
            )}
            {storyEventId === e.id && storyNarrative && !storyLoading && (
              <p className="mt-2 text-[11px] text-white/70 border-t border-white/10 pt-2">{storyNarrative}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
