'use client'

import { useEffect, useState } from 'react'
import type { DemoTeam } from '@/lib/demo-league/types'
import { TeamBadge } from './TeamBadge'

type Result = { name: string; position: string | null; team: string | null; imageUrl: string | null; demoTeam: DemoTeam | null }

export function DemoPlayerFinder() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/demo/players?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const json = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string }
        if (!res.ok) setError(json.error ?? 'Search is unavailable right now.')
        setResults(json.results ?? [])
      } catch {
        /* aborted */
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  return (
    <div className="space-y-3">
      <label htmlFor="demo-player-q" className="sr-only">Search players</label>
      <input
        id="demo-player-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search any player — or browse this league's rosters"
        className="af-control w-full px-3 text-sm"
      />
      {error ? <p className="text-sm" style={{ color: 'var(--color-danger)' }}>{error}</p> : null}
      <ul className="af-card divide-y" aria-busy={loading}>
        {results.length === 0 && !loading ? <li className="p-4 text-sm af-muted">No players found.</li> : null}
        {results.map((r, i) => (
          <li key={`${r.name}-${i}`} className="flex items-center gap-3 p-3 text-sm">
            {r.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.imageUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" loading="lazy" />
            ) : (
              <span aria-hidden="true" className="inline-block h-8 w-8 rounded-full" style={{ background: 'var(--surface-inset)' }} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{r.name}</span>
              <span className="block text-xs af-muted">{[r.position, r.team].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="shrink-0 text-right text-xs">
              {r.demoTeam ? <TeamBadge team={r.demoTeam} size={22} /> : <span className="af-muted">Free agent here</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
