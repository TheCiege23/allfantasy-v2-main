'use client'

import { useCallback, useEffect, useState } from 'react'

type Row = {
  id: string
  actionType: string
  entityType: string
  entityId: string | null
  beforeState: unknown
  afterState: unknown
  metadata: unknown
  createdAt: string
  userId: string | null
}

export default function AuditLogViewer({
  leagueId,
  /** Increment (e.g. after commissioner actions) to refetch without remounting the page. */
  refreshSignal = 0,
}: {
  leagueId: string
  refreshSignal?: number
}) {
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const q = filter.trim()
      const url =
        q.length > 0
          ? `/api/leagues/${leagueId}/audit-logs?types=${encodeURIComponent(q)}`
          : `/api/leagues/${leagueId}/audit-logs`
      const res = await fetch(url)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(typeof data.error === 'string' ? data.error : 'Failed to load audit log')
        setRows([])
        return
      }
      setRows(Array.isArray(data.items) ? data.items : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [leagueId, filter])

  useEffect(() => {
    void load()
  }, [load, refreshSignal])

  return (
    <div
      className="rounded-xl border border-white/10 bg-[#0a1228]/90 p-3 text-left"
      data-testid="league-audit-log-viewer"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/90">Audit log</p>
          <p className="text-xs text-white/50">Recent commissioner and system actions</p>
        </div>
        <input
          className="ml-auto min-w-[140px] rounded-lg border border-white/10 bg-[#040915] px-2 py-1.5 text-xs text-white placeholder:text-white/35"
          placeholder="Filter by action type"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onBlur={() => void load()}
        />
        <button
          type="button"
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-xs font-medium text-sky-100"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="mt-3 text-xs text-white/50">Loading…</p> : null}
      {err ? <p className="mt-3 text-xs text-red-300/90">{err}</p> : null}

      {!loading && !err && rows.length === 0 ? (
        <p className="mt-3 text-xs text-white/45">No entries yet.</p>
      ) : null}

      <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-2 text-xs text-white/80"
          >
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-medium text-white">{r.actionType}</span>
              <span className="text-white/45">{r.entityType}</span>
              {r.entityId ? <span className="text-white/35">{r.entityId}</span> : null}
            </div>
            <p className="mt-1 text-[11px] text-white/40">
              {new Date(r.createdAt).toLocaleString()}
            </p>
            {(r.beforeState != null || r.afterState != null) && (
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-snug text-white/45">
                {r.beforeState != null ? `− ${JSON.stringify(r.beforeState)}\n` : ''}
                {r.afterState != null ? `+ ${JSON.stringify(r.afterState)}` : ''}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
