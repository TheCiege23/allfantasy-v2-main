'use client'

import { useCallback, useEffect, useState } from 'react'

type State =
  | { configured: false }
  | { configured: true; source: { leagueId: string; setAt: string }; league: { id: string; name: string | null; platform: string; sport: string; season: number } | null }

export default function DemoLeagueAdminClient() {
  const [state, setState] = useState<State | null>(null)
  const [leagueId, setLeagueId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/demo-league', { credentials: 'include', cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (res.ok) setState(json as State)
    else setMessage((json as { error?: string } | null)?.error ?? `Could not load (${res.status})`)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (method: 'PUT' | 'DELETE') => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/demo-league', {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ leagueId: leagueId.trim() }) : undefined,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage((json as { error?: string } | null)?.error ?? `Failed (${res.status})`)
        return
      }
      setState(json as State)
      setMessage(method === 'PUT' ? 'Demo source saved. /demo now shows this league, anonymized.' : 'Demo turned off.')
      setLeagueId('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-testid="demo-league-admin">
      <h2 className="text-lg font-black">Current source</h2>
      {state == null ? (
        <p className="mt-2 text-sm text-white/60">Loading…</p>
      ) : state.configured ? (
        <div className="mt-2 text-sm leading-6 text-white/80">
          <p>
            <span className="font-semibold">{state.league?.name ?? 'League not found'}</span>{' '}
            {state.league ? `· ${state.league.platform} · ${state.league.sport} ${state.league.season}` : ''}
          </p>
          <p className="text-white/50">League ID {state.source.leagueId} · set {new Date(state.source.setAt).toLocaleString()}</p>
          <p className="mt-1 text-white/50">Only you see the real name here. Visitors see “AllFantasy Demo League”.</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-white/60">Not set — /demo shows “demo unavailable”.</p>
      )}

      <label className="mt-5 block text-sm font-semibold" htmlFor="demo-league-id">
        League ID — AllFantasy or provider (Sleeper, ESPN, Fantrax…). Must be one you commission.
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="demo-league-id"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value)}
          placeholder="e.g. 1313549607426334720 or an AllFantasy league id"
          className="min-h-11 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 text-sm text-white placeholder:text-white/35"
        />
        <button
          type="button"
          disabled={busy || !leagueId.trim()}
          onClick={() => void save('PUT')}
          className="min-h-11 rounded-xl bg-cyan-500 px-5 text-sm font-black text-slate-950 disabled:opacity-50"
        >
          Use as demo source
        </button>
      </div>
      {state?.configured ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save('DELETE')}
          className="mt-3 min-h-10 rounded-xl border border-rose-400/40 px-4 text-sm font-semibold text-rose-200 disabled:opacity-50"
        >
          Turn the demo off
        </button>
      ) : null}
      {message ? <p className="mt-3 text-sm text-amber-100" role="status">{message}</p> : null}
    </section>
  )
}
