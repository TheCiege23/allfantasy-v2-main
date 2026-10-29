'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

/**
 * The free "bench my starters on bye automatically" switch for the manager's own team
 * (lib/lineup-automation/autoBenchByePolicy.ts). Hidden where the league cannot use it — an imported,
 * daily-lineup, best-ball or automatic-lineup league — which the GET reports as `available: false`.
 */
export function AutoBenchByeToggle({ leagueId }: { leagueId: string }) {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/league/auto-bench-bye?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { available?: boolean; on?: boolean } | null) => {
        if (alive) setOn(j?.available ? Boolean(j.on) : null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [leagueId])

  if (on == null) return null

  const change = async (next: boolean) => {
    setBusy(true)
    try {
      const res = await fetch('/api/league/auto-bench-bye', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, on: next }),
      })
      const j = (await res.json().catch(() => ({}))) as { on?: boolean; error?: string }
      if (!res.ok) throw new Error(j.error ?? 'Could not save.')
      setOn(Boolean(j.on))
      toast.success(next ? 'Starters on bye will be benched automatically.' : 'Automatic bye benching is off.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="nls-muted" data-testid="auto-bench-bye-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} aria-describedby="auto-bench-bye-help" />
      <span>
        Bench my starters on bye automatically
        <small id="auto-bench-bye-help" style={{ display: 'block' }}>
          Swaps each starter on bye for your best bench player who can play. Free; you can still set your lineup yourself.
        </small>
      </span>
    </label>
  )
}
