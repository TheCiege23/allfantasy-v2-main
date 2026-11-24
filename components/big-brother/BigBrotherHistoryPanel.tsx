'use client'

import { useEffect, useState } from 'react'
import { describeBigBrotherAuditEvent } from './bigBrotherCopy'

type AuditRow = { eventType: string; metadata: unknown; createdAt: string }

/** `names`: roster id → display name, from the summary the home already loaded. */
export function BigBrotherHistoryPanel({ leagueId, names = {} }: { leagueId: string; names?: Record<string, string> }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<AuditRow[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(leagueId)}/big-brother/audit?limit=80`,
          { cache: 'no-store' },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error ?? `Error ${res.status}`)
          return
        }
        if (!cancelled) setLog(Array.isArray(data.log) ? data.log : [])
      } catch {
        if (!cancelled) setError('Failed to load history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white/[0.03] p-6 text-sm text-[var(--text2)]">
        Loading ceremony log…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--line2)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn)]">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--accent-line)] bg-[var(--surface2)] p-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">House log</h3>
      <ul className="space-y-2 text-[13px]">
        {log.length === 0 ? (
          <li className="text-[var(--muted)]">No events yet.</li>
        ) : (
          log.map((row, i) => {
            // Each row as a sentence. It printed the event code over a JSON dump of its metadata (2026-11-09 audit).
            const { title, detail } = describeBigBrotherAuditEvent(row, names)
            return (
              <li
                key={`${row.createdAt}-${i}`}
                className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[var(--text)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-[var(--accent)]">{title}</span>
                  <time className="text-[11px] text-[var(--muted)]" dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </time>
                </div>
                {detail ? <p className="mt-1 text-[12px] text-[var(--text2)]">{detail}</p> : null}
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
