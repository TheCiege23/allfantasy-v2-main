'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { Zap, BookOpen, ExternalLink } from 'lucide-react'
import { postWithTokenConfirm } from '@/lib/tokens/clientTokenConfirm'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

interface DramaEventItem {
  id: string
  dramaType: string
  headline: string
  summary: string | null
  dramaScore: number
  createdAt: string
}

/** "RIVALRY_CLASH" → "Rivalry clash" (2026-11-23: the codes were shown as they are stored). */
export function dramaTypeLabel(code: string): string {
  const t = code.toLowerCase().replace(/_/g, ' ').trim()
  return t ? t[0]!.toUpperCase() + t.slice(1) : 'Storyline'
}

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
  // One league is one sport and one season: no pickers (2026-11-23), the props decide.
  const sport = normalizeToSupportedSport(sportProp ?? DEFAULT_SPORT)
  const season: number | null = seasonProp ?? currentYear
  const dramaTypeFilter: string = 'ALL'
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
    // Asks before any token is spent; a decline spends nothing and closes the story.
    postWithTokenConfirm(`/api/leagues/${encodeURIComponent(leagueId)}/drama/tell-story`, { eventId })
      .then(async ({ response: r, declined }) => {
        if (declined) return { declined: true as const }
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
        if (data?.declined) {
          setStoryEventId(null)
          setStoryLoading(null)
          return
        }
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
      <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading storylines…</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--warn)] flex items-center gap-2">
          <Zap className="h-4 w-4" />
          League drama
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runEngine}
            disabled={running}
            className="rounded border border-[var(--line2)] px-2 py-1 text-[11px] text-[var(--warn)] hover:bg-[var(--warn-soft)] disabled:opacity-50"
          >
            {running ? 'Looking…' : 'Find new storylines'}
          </button>
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/drama`}
            className="rounded border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--text2)] hover:bg-[var(--chip)]"
          >
            Timeline
          </Link>
        </div>
      </div>
      {error && <p className="text-xs text-[var(--bad)]">{error}</p>}
      {events.length === 0 && !error && (
        <p className="text-xs text-[var(--muted)]">No storylines yet. They appear as rivalries and close games build.</p>
      )}
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface2)] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--text)] truncate">{e.headline}</p>
                {e.summary && <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-2">{e.summary}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--warn-soft)] text-[var(--warn)]">{dramaTypeLabel(e.dramaType)}</span>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => tellStory(e.id)}
                  className="flex items-center gap-0.5 rounded border border-[var(--accent-line)] px-1.5 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                  title="Tell me the story"
                >
                  <BookOpen className="h-3 w-3" />
                  Story
                </button>
                <Link
                  href={`/app/league/${leagueId}/drama/${e.id}`}
                  className="flex items-center gap-0.5 rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--text2)] hover:bg-[var(--chip)]"
                  title="View storyline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View
                </Link>
                {e.dramaType === 'TRADE_FALLOUT' && (
                  <Link
                    href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
                    className="rounded border border-[var(--accent-line)] px-1.5 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
                  >
                    Trade context
                  </Link>
                )}
              </div>
            </div>
            {storyEventId === e.id && storyLoading === e.id && (
              <p className="mt-2 text-[11px] text-[var(--muted)] border-t border-[var(--line)] pt-2">Loading story…</p>
            )}
            {storyEventId === e.id && storyNarrative && !storyLoading && (
              <p className="mt-2 text-[11px] text-[var(--text2)] border-t border-[var(--line)] pt-2">{storyNarrative}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
