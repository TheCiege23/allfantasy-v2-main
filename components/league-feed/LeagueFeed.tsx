'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'
import { LeagueFeedCard, type LeagueFeedCardRow } from '@/components/league-feed/LeagueFeedCard'
import { feedItemMatchesFilter, LeagueFeedFilters, type LeagueFeedFilterId } from '@/components/league-feed/LeagueFeedFilters'

type ApiRow = LeagueFeedCardRow & { visibility?: string | null }

export default function LeagueFeed({
  leagueId,
  refreshSignal = 0,
}: {
  leagueId: string
  refreshSignal?: number
}) {
  const [rows, setRows] = useState<ApiRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<LeagueFeedFilterId>('all')
  const [newestId, setNewestId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/activity-feed`, {
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Failed to load activity')
        setRows([])
        return
      }
      const items = Array.isArray(data.items) ? data.items : []
      const mapped: ApiRow[] = items.map(
        (r: {
          id: string
          type: string
          message: string
          createdAt: string
          source?: string
          title?: string | null
          flavorLine?: string | null
          actorType?: string | null
          actorName?: string | null
          teamName?: string | null
          category?: string | null
          importance?: string | null
          botArchetypeLabel?: string | null
          visibility?: string | null
        }) => ({
          id: r.id,
          source: r.source,
          type: r.type,
          title: r.title,
          message: r.message,
          flavorLine: r.flavorLine,
          actorType: r.actorType,
          actorName: r.actorName,
          teamName: r.teamName,
          category: r.category,
          importance: r.importance,
          botArchetypeLabel: r.botArchetypeLabel,
          createdAt: r.createdAt,
          visibility: r.visibility,
        }),
      )
      setRows((prev) => {
        const prevTop = prev[0]?.id
        const nextTop = mapped[0]?.id
        if (nextTop && nextTop !== prevTop) setNewestId(nextTop)
        return mapped
      })
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load, refreshSignal])

  useLeagueRealtimeRefresh(leagueId, () => {
    void load()
  })

  const filtered = useMemo(() => {
    return rows.filter((r) => feedItemMatchesFilter(filter, r))
  }, [rows, filter])

  return (
    <div
      className="mb-4 rounded-xl border border-white/10 bg-[#0a1228]/90 p-3 text-left shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
      data-testid="league-activity-feed"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/90">League feed</p>
          <p className="text-xs text-white/50">Activity, trades, waivers — and AI flavor when enabled</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <div className="mt-3">
        <LeagueFeedFilters active={filter} onChange={setFilter} disabled={loading || Boolean(err)} />
      </div>

      {loading ? <p className="mt-3 text-xs text-white/50">Loading…</p> : null}
      {err ? <p className="mt-3 text-xs text-red-300/90">{err}</p> : null}

      {!loading && !err && filtered.length === 0 ? (
        <p className="mt-3 text-xs text-white/45">No activity for this filter yet.</p>
      ) : null}

      <ul className="mt-3 max-h-[min(420px,55vh)] space-y-2 overflow-y-auto pr-1">
        {filtered.map((r) => (
          <LeagueFeedCard key={r.id} row={r} animateIn={r.id === newestId} />
        ))}
      </ul>
    </div>
  )
}
