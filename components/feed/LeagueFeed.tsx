'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ActivityFeedItem } from '@/lib/activity/types'
import FeedEvent from '@/components/feed/FeedEvent'
import FeedFilterChips, { FEED_FILTERS, type FeedFilterId } from '@/components/feed/FeedFilterChips'

/**
 * 10c — the league feed.
 *
 * Reads the existing multi-source aggregator (`/api/shared/activity`) rather than adding a feed of
 * its own. That endpoint already merges Sleeper transactions, native AF league events and roster
 * injuries, de-dupes, sorts newest-first, and carries an explicit rule that every item traces to a
 * real source and sources with no real feed are omitted — which is exactly the contract this
 * screen needs. Build rule 4 (works identically for imported leagues) falls out of that for free:
 * the source is invisible here.
 *
 * ⚠ "LOAD OLDER EVENTS" GROWS THE LIMIT; IT IS NOT A CURSOR. The endpoint takes `limit` (hard cap
 * 100) and no offset, so paging asks for a larger window and re-renders. That is honest but
 * finite: at 100 the control says so instead of pretending there is more to fetch. A real cursor
 * belongs in the endpoint, not in a re-fetch loop here that would silently drop events between
 * pages.
 */

const PAGE = 25
const MAX_LIMIT = 100

export default function LeagueFeed({
  leagueId,
  leagueName,
}: {
  leagueId: string
  leagueName: string
}) {
  const [items, setItems] = useState<ActivityFeedItem[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [filter, setFilter] = useState<FeedFilterId>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    async (nextLimit: number) => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch(
          `/api/shared/activity?leagueId=${encodeURIComponent(leagueId)}&limit=${nextLimit}`,
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? 'Could not load the feed')
        // The endpoint always answers `{ status, items }` — including its honest-empty
        // back-pressure path, which returns items: [] rather than an error.
        setItems(Array.isArray(data.items) ? data.items : [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the feed')
      } finally {
        setLoading(false)
      }
    },
    [leagueId],
  )

  useEffect(() => {
    void load(limit)
  }, [load, limit])

  const visible = useMemo(() => {
    const def = FEED_FILTERS.find((f) => f.id === filter)
    if (!def || def.types.length === 0) return items
    return items.filter((i) => def.types.includes(i.type))
  }, [items, filter])

  const atCap = limit >= MAX_LIMIT

  return (
    <div className="mx-auto max-w-[900px] space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-black tracking-[-0.02em] text-white">Feed</h1>
          <span className="text-sm text-white/50">{leagueName}</span>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
          Newest first
        </span>
      </div>

      <FeedFilterChips active={filter} onChange={setFilter} />

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-12 text-cyan-300">
          <Loader2 className="h-7 w-7 animate-spin" />
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <p className="py-10 text-center text-sm text-white/50">
          Nothing has happened in this league yet — trades, waivers and commissioner notices land
          here as they occur.
        </p>
      ) : null}

      {items.length > 0 && visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-white/50">
          No {filter} events in this stretch of the feed.
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5" data-testid="feed-list">
        {visible.map((item) => (
          <FeedEvent key={item.id} item={item} />
        ))}
      </div>

      {/* Build rule 5: explicit pagination, never infinite scroll — the read position stays put. */}
      {visible.length > 0 ? (
        <div className="pt-2 text-center">
          {atCap ? (
            <span className="text-xs text-white/35">
              Showing the most recent {MAX_LIMIT} events — the feed doesn&apos;t page further back
              yet.
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setLimit((n) => Math.min(n + PAGE, MAX_LIMIT))}
              disabled={loading}
              data-testid="feed-load-older"
              className="text-sm font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load older events'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
