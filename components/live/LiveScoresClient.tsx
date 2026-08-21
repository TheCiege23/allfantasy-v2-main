'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LivePageData } from '@/lib/live/liveScoresPage'
import { ScopeToggle } from './ScopeToggle'
import { SportTabs } from './SportTabs'
import { MatchupCard } from './MatchupCard'
import { LiveImpactPanel } from './LiveImpactPanel'

/**
 * Client shell for `/live`: owns scope, sport, polling and the freshness clock.
 *
 * ⚠ THE "UPDATED Ns AGO" COUNTER IS REAL AND TICKS. Build rule 5 makes real-time
 * accuracy this page's entire premise, so the label is derived from the payload's
 * own `fetchedAt` and re-rendered on a one-second interval. A static "updated
 * just now" would be the single most misleading thing this screen could say.
 *
 * ⚠ POLL CADENCE FOLLOWS WHETHER ANYTHING IS ACTUALLY LIVE. 20s while a game is
 * in progress, 2 minutes otherwise — the same shape as the server-side cadence
 * engine. Polling every 20s all Tuesday would burn requests to re-fetch a slate
 * that cannot change.
 */

const LIVE_POLL_MS = 20_000
const IDLE_POLL_MS = 120_000

export function LiveScoresClient({ initial }: { initial: LivePageData }) {
  const [data, setData] = useState<LivePageData>(initial)
  const [scope, setScope] = useState<'my' | 'all'>(initial.scope)
  const [sport, setSport] = useState(initial.sport)
  /*
   * ⚠ NULL UNTIL MOUNTED, AND THAT IS A HYDRATION FIX AND AN HONESTY ONE.
   * Seeding this with `Date.now()` runs it on the server AND again in the
   * browser, which produced different values and failed hydration outright
   * ("Server: 0s, Client: 2s"). It is also the more truthful shape: the server
   * cannot know how stale the payload will be by the time the browser paints it,
   * so the age is a client-only fact and renders only once there is a client.
   */
  const [now, setNow] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  // Guards against a slow response for an old sport landing after a new one.
  const requestSeq = useRef(0)

  const load = useCallback(
    async (nextSport: string, nextScope: 'my' | 'all') => {
      const seq = ++requestSeq.current
      setIsRefreshing(true)
      try {
        const res = await fetch(
          `/api/dashboard/live-scores?view=live&sport=${encodeURIComponent(nextSport)}&scope=${nextScope}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const json = (await res.json()) as LivePageData
        // A stale response must never overwrite a newer one.
        if (seq !== requestSeq.current) return
        setData(json)
        setNow(Date.now())
      } catch {
        // A failed poll leaves the last good data on screen. The freshness label
        // keeps counting up, which is exactly the honest signal: the numbers are
        // getting older and the user can see it.
      } finally {
        if (seq === requestSeq.current) setIsRefreshing(false)
      }
    },
    [],
  )

  const anyLive = data.games.some((g) => g.isLive)

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load(sport, scope)
    }, anyLive ? LIVE_POLL_MS : IDLE_POLL_MS)
    return () => window.clearInterval(interval)
  }, [load, sport, scope, anyLive])

  // The freshness clock ticks independently of the poll so the label stays true
  // between refreshes — and keeps climbing when a refresh fails.
  useEffect(() => {
    setNow(Date.now())
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  const onSport = (next: string) => {
    setSport(next)
    void load(next, scope)
  }
  const onScope = (next: 'my' | 'all') => {
    setScope(next)
    void load(sport, next)
  }

  return (
    <div className="live-page">
      <header
        className="sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--live-line2)' }}
      >
        <h1 className="live-display text-[20px] font-black">Live Scores</h1>
        <ScopeToggle scope={scope} onChange={onScope} />
        <div className="ml-auto">
          <FreshnessBadge fetchedAt={data.fetchedAt} now={now} anyLive={anyLive} isRefreshing={isRefreshing} />
        </div>
      </header>

      <div className="px-4 sm:px-6" style={{ borderBottom: '1px solid var(--live-line2)' }}>
        <SportTabs counts={data.counts} active={sport} onSelect={onSport} />
      </div>

      <div className="live-grid px-4 py-5 sm:px-6">
        <main className="flex min-w-0 flex-col gap-4">
          <p
            className="live-mono text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--muted2)' }}
          >
            {data.sport} · sorted by leagues affected
          </p>
          {data.games.length === 0 ? (
            <EmptyState scope={scope} hasRosterData={data.hasRosterData} loadFailed={data.loadFailed} />
          ) : (
            data.games.map((game) => <MatchupCard key={game.gameId} game={game} />)
          )}
        </main>
        <LiveImpactPanel impact={data.impact} hasRosterData={data.hasRosterData} />
      </div>
    </div>
  )
}

/**
 * ⚠ SAYS "UPDATED Ns AGO" ONLY WHEN IT KNOWS. An unparseable or missing
 * `fetchedAt` renders no age at all rather than "just now" — claiming freshness
 * we cannot demonstrate is the failure mode this page exists to avoid.
 */
function FreshnessBadge({
  fetchedAt,
  now,
  anyLive,
  isRefreshing,
}: {
  fetchedAt: string
  now: number | null
  anyLive: boolean
  isRefreshing: boolean
}) {
  const at = new Date(fetchedAt).getTime()
  // No age before mount and none for an unparseable timestamp — both render the
  // badge without a claim about freshness rather than with a wrong one.
  const ageSeconds =
    now == null || Number.isNaN(at) ? null : Math.max(0, Math.round((now - at) / 1000))

  return (
    <span
      className="live-mono flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
      style={{
        background: anyLive ? 'color-mix(in srgb, var(--bad) 12%, transparent)' : 'var(--live-chip)',
        color: anyLive ? 'var(--bad)' : 'var(--muted)',
        border: `1px solid ${anyLive ? 'color-mix(in srgb, var(--bad) 30%, transparent)' : 'var(--live-line2)'}`,
      }}
      aria-live="polite"
    >
      {anyLive ? <span className="live-dot" aria-hidden="true" /> : null}
      {anyLive ? 'Live' : 'Idle'}
      {ageSeconds != null ? <span>· updated {formatAge(ageSeconds)} ago</span> : null}
      {isRefreshing ? <span style={{ opacity: 0.7 }}>·</span> : null}
    </span>
  )
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

/**
 * ⚠ "COULD NOT LOAD" AND "NOTHING IS ON" ARE DIFFERENT CLAIMS. An outage
 * rendered as an empty slate is a confident lie, and on a live-scoring page it
 * is the worst one available — the user concludes their players are not playing.
 */
function EmptyState({
  scope,
  hasRosterData,
  loadFailed,
}: {
  scope: 'my' | 'all'
  hasRosterData: boolean
  loadFailed: boolean
}) {
  if (loadFailed) {
    return (
      <div
        className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
      >
        <p className="live-display text-[15px] font-bold" style={{ color: 'var(--bad)' }}>
          Scores could not be loaded.
        </p>
        <p className="live-display mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
          This is a problem on our end, not an empty slate — there may well be games on. Retrying
          automatically.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-2xl p-8 text-center"
      style={{ background: 'var(--panel)', border: '1px solid var(--live-line2)' }}
    >
      <p className="live-display text-[15px] font-bold">
        {scope === 'my' ? 'None of your players are playing right now.' : 'No games on this slate.'}
      </p>
      <p className="live-display mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
        {scope === 'my' && !hasRosterData
          ? 'Claim a team in one of your leagues and this fills in automatically.'
          : scope === 'my'
            ? 'Switch to All games to see the rest of the slate.'
            : 'Nothing is scheduled in this window.'}
      </p>
    </div>
  )
}
