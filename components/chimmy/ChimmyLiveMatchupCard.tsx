'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const REFRESH_MS = 60_000

/** A visible, user-opened score panel. Polling stops while hidden or unmounted. */
export default function ChimmyLiveMatchupCard({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let busy = false
    async function refresh() {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      setLoading(true)
      try {
        const response = await fetch(`/api/chat/chimmy/live-matchup?leagueId=${encodeURIComponent(leagueId)}`,
          { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Score refresh failed')
        const data = await response.json() as { context?: string; readAt?: string }
        if (!data.context || !data.readAt) throw new Error('Score response was incomplete')
        setContext(data.context)
        setReadAt(data.readAt)
        setError(null)
      } catch {
        if (!controller.signal.aborted) setError('Could not refresh the matchup. Try again shortly.')
      } finally {
        busy = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [leagueId, open, revision])

  return <section className="rounded-xl border border-cyan-400/20 bg-cyan-950/20 p-3 text-sm text-white/80" aria-label="Live fantasy matchup">
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="font-medium text-cyan-200 hover:text-cyan-100">
        {open ? 'Hide live matchup' : 'Show live matchup'}
      </button>
      {open && <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}
        aria-label="Refresh live matchup" className="rounded p-1 text-cyan-200 disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </button>}
    </div>
    {open && <div className="mt-2">
      {readAt && <p className="mb-2 text-xs text-white/50">Checked {new Date(readAt).toLocaleTimeString()} · refreshes every minute while open</p>}
      {error && <p role="status" className="text-amber-200">{error}</p>}
      {context ? <p className="whitespace-pre-wrap break-words">{context}</p> : loading ? <p role="status">Loading matchup…</p> : null}
    </div>}
  </section>
}
