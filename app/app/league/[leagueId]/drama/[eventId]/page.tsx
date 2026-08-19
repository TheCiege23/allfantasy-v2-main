'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen } from 'lucide-react'

interface DramaEventDetail {
  id: string
  leagueId: string
  headline: string
  summary: string | null
  dramaType: string
  dramaScore: number
  relatedManagerIds: string[]
  relatedTeamIds: string[]
  relatedMatchupId: string | null
  createdAt: string
}

export default function DramaEventDetailPage() {
  const router = useRouter()
  const params = useParams<{ leagueId: string; eventId: string }>() ?? ({} as { leagueId: string; eventId: string })
  const leagueId = params?.leagueId ?? ''
  const eventId = params?.eventId ?? ''
  const [event, setEvent] = useState<DramaEventDetail | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [rivalryResolving, setRivalryResolving] = useState(false)
  const [rivalryError, setRivalryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!leagueId || !eventId) return
    setLoading(true)
    setError(null)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/${encodeURIComponent(eventId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) setEvent(data)
        else setError('Event not found')
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [leagueId, eventId])

  const tellStory = () => {
    if (!leagueId || !eventId) return
    setNarrative(null)
    setNarrativeLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/drama/tell-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
      .then((r) => r.json())
      .then((data) => setNarrative(data?.narrative ?? 'No story available.'))
      .catch(() => setNarrative('Could not load story.'))
      .finally(() => setNarrativeLoading(false))
  }

  const openLinkedRivalry = async () => {
    if (!event || event.relatedManagerIds.length < 2) {
      setRivalryError('No linked rivalry managers on this storyline.')
      return
    }
    setRivalryResolving(true)
    setRivalryError(null)
    try {
      const [managerAId, managerBId] = event.relatedManagerIds
      const params = new URLSearchParams({
        managerAId,
        managerBId,
        limit: '1',
      })
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/rivalries?${params.toString()}`,
        { cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to resolve rivalry')
      const rivalryId = Array.isArray(data?.rivalries) && data.rivalries[0]?.id
      if (!rivalryId) {
        setRivalryError('No rivalry record found for this manager pair.')
        return
      }
      const navParams = new URLSearchParams()
      if (event?.dramaType) navParams.set('from', event.dramaType)
      router.push(
        `/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(rivalryId)}${
          navParams.toString() ? `?${navParams.toString()}` : ''
        }`
      )
    } catch (e) {
      setRivalryError(e instanceof Error ? e.message : 'Could not open linked rivalry.')
    } finally {
      setRivalryResolving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <p className="text-sm text-white/50">Loading storyline…</p>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="space-y-4 p-4">
        <Link
          href={`/league/${leagueId}`}
          className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to league
        </Link>
        <p className="text-red-300">{error ?? 'Event not found'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/league/${leagueId}`}
          className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to league
        </Link>
        <Link
          // The timeline lives under /app/league, not /league — the unprefixed
          // path 404s. `Back to league` above is right to omit /app, because
          // /league/<id> DOES exist (and /app/league/<id> redirects to it), which
          // is why one missing prefix here looked consistent with its neighbour.
          href={`/app/league/${leagueId}/drama`}
          className="inline-flex items-center gap-1 text-sm text-amber-200 hover:underline"
        >
          Open drama timeline
        </Link>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded border border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
        >
          Refresh page
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-bold text-white">{event.headline}</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 shrink-0">
            {event.dramaType}
          </span>
        </div>
        {event.summary && <p className="text-sm text-white/70">{event.summary}</p>}
        <p className="text-xs text-white/50">Drama score: {event.dramaScore.toFixed(0)}/100</p>
        {(event.relatedManagerIds?.length > 0 || event.relatedTeamIds?.length > 0) && (
          <div className="text-xs text-white/50">
            {event.relatedManagerIds?.length > 0 && (
              <p>Managers: {event.relatedManagerIds.join(', ')}</p>
            )}
            {event.relatedTeamIds?.length > 0 && (
              <p>Teams: {event.relatedTeamIds.join(', ')}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {event.dramaType === 'RIVALRY_CLASH' && event.relatedManagerIds.length >= 2 && (
            <button
              type="button"
              onClick={() => void openLinkedRivalry()}
              disabled={rivalryResolving}
              className="rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs text-purple-200 hover:bg-purple-500/20 disabled:opacity-50"
            >
              {rivalryResolving ? 'Opening rivalry…' : 'Open linked rivalry'}
            </button>
          )}
          {event.relatedMatchupId && (
            <Link
              href={`/league/${leagueId}?tab=Matchups`}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/75 hover:bg-white/10"
            >
              Open matchup context
            </Link>
          )}
          {event.dramaType === 'TRADE_FALLOUT' && (
            <Link
              href={`/league/${leagueId}?tab=Trades`}
              className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
            >
              Open trade fallout context
            </Link>
          )}
        </div>
        {rivalryError && <p className="text-xs text-red-300">{rivalryError}</p>}
        <button
          type="button"
          onClick={tellStory}
          disabled={narrativeLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          <BookOpen className="h-4 w-4" />
          {narrativeLoading ? 'Loading…' : 'Tell me the story'}
        </button>
        {narrative && (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-sm text-white/80 leading-relaxed">{narrative}</p>
          </div>
        )}
      </div>
    </div>
  )
}
