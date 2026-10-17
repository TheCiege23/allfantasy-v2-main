'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ExternalLink, Zap } from 'lucide-react'
import { postWithTokenConfirm, responseErrorMessage } from '@/lib/tokens/clientTokenConfirm'

type DramaEventRow = {
  id: string
  dramaType: string
  headline: string
  summary: string | null
  dramaScore: number
}

export function MatchupDramaWidget({
  leagueId,
  matchupId,
  teamAId,
  teamBId,
  sport,
  season,
}: {
  leagueId: string
  matchupId?: string | null
  teamAId?: string
  teamBId?: string
  sport?: string
  season?: number | null
}) {
  const [events, setEvents] = useState<DramaEventRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storyByEvent, setStoryByEvent] = useState<Record<string, string>>({})
  const [storyLoadingId, setStoryLoadingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '4' })
      if (sport) params.set('sport', sport)
      if (season != null) params.set('season', String(season))
      if (matchupId) {
        params.set('relatedMatchupId', matchupId)
      } else if (teamAId) {
        params.set('relatedTeamId', teamAId)
      }
      const primary = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/drama?${params.toString()}`,
        { cache: 'no-store' }
      )
      const primaryJson = await primary.json().catch(() => ({}))
      let rows: DramaEventRow[] = Array.isArray(primaryJson?.events) ? primaryJson.events : []
      if (rows.length === 0 && teamBId && !matchupId) {
        const fallbackParams = new URLSearchParams({ limit: '4', relatedTeamId: teamBId })
        if (sport) fallbackParams.set('sport', sport)
        if (season != null) fallbackParams.set('season', String(season))
        const fallback = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/drama?${fallbackParams.toString()}`,
          { cache: 'no-store' }
        )
        const fallbackJson = await fallback.json().catch(() => ({}))
        rows = Array.isArray(fallbackJson?.events) ? fallbackJson.events : []
      }
      setEvents(rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load matchup drama')
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [leagueId, matchupId, teamAId, teamBId, sport, season])

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
        // Asks before any token is spent; a decline spends nothing and shows nothing.
        const { response: res, declined } = await postWithTokenConfirm(
          `/api/leagues/${encodeURIComponent(leagueId)}/drama/tell-story`,
          { eventId },
        )
        if (declined) return
        const text = res.ok
          ? ((await res.json().catch(() => ({})))?.narrative ?? 'No story available.')
          : await responseErrorMessage(res, 'Could not load story.')
        setStoryByEvent((prev) => ({
          ...prev,
          [eventId]: text,
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
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-amber-200 flex items-center gap-1">
          <Zap className="h-3.5 w-3.5" />
          Matchup drama
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>
      {loading && <p className="mt-1.5 text-[11px] text-white/55">Loading storyline context…</p>}
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <p className="mt-1.5 text-[11px] text-white/55">No drama storyline tied to this matchup yet.</p>
      )}
      <ul className="mt-2 space-y-1.5">
        {events.map((e) => (
          <li key={e.id} className="rounded border border-white/10 bg-black/20 p-2">
            <p className="text-[11px] text-white/85">{e.headline}</p>
            {e.summary && <p className="mt-0.5 text-[11px] text-white/55 line-clamp-2">{e.summary}</p>}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[11px] text-amber-200">
                {e.dramaType}
              </span>
              <span className="text-[11px] text-white/45">Score {Math.round(e.dramaScore)}</span>
              <button
                type="button"
                onClick={() => void tellStory(e.id)}
                className="ml-auto inline-flex items-center gap-1 rounded border border-cyan-500/25 px-1.5 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/15"
              >
                <BookOpen className="h-3 w-3" />
                {storyLoadingId === e.id ? 'Loading…' : storyByEvent[e.id] ? 'Hide story' : 'Story'}
              </button>
              <Link
                href={`/app/league/${encodeURIComponent(leagueId)}/drama/${encodeURIComponent(e.id)}`}
                className="inline-flex items-center gap-1 rounded border border-white/20 px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/10"
              >
                <ExternalLink className="h-3 w-3" />
                View
              </Link>
            </div>
            {storyByEvent[e.id] && (
              <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] text-white/70">
                {storyByEvent[e.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
