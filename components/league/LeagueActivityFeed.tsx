'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLeagueRealtimeRefresh } from '@/hooks/useLeagueRealtimeRefresh'

type Row = {
  id: string
  source?: string
  type: string
  message: string
  title?: string | null
  createdAt: string
}

export default function LeagueActivityFeed({
  leagueId,
  refreshSignal = 0,
}: {
  leagueId: string
  refreshSignal?: number
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

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
      setRows(
        items.map(
          (r: {
            id: string
            type: string
            message: string
            createdAt: string
            source?: string
            title?: string | null
          }) => ({
            id: r.id,
            source: r.source,
            type: r.type,
            title: r.title,
            message: r.message,
            createdAt: r.createdAt,
          }),
        ),
      )
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

  return (
    <div
      className="mb-4 rounded-xl border border-white/10 bg-[#0a1228]/90 p-3 text-left"
      data-testid="league-activity-feed"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/90">League activity</p>
          <p className="text-xs text-white/50">Live updates for your league</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/5"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="mt-3 text-xs text-white/50">Loading…</p> : null}
      {err ? <p className="mt-3 text-xs text-red-300/90">{err}</p> : null}

      {!loading && !err && rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/45">No activity yet.</p>
      ) : null}

      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5 text-xs text-white/80">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
              {r.source ? `${r.source} · ` : ''}
              {r.type}
            </span>
            {r.title ? <p className="mt-0.5 font-medium text-white/90">{r.title}</p> : null}
            <p className="mt-0.5 text-white/85">{r.message}</p>
            <p className="mt-0.5 text-[11px] text-white/35">{new Date(r.createdAt).toLocaleString()}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
