'use client'

import { useEffect, useState } from 'react'

export function ZombieAdvancedPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    void fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load league status.')
        return res.json() as Promise<{ league?: { status?: string } }>
      })
      .then((data) => { if (active) setStatus(data.league?.status ?? null) })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load league status.') })
    return () => { active = false }
  }, [leagueId])

  async function run(action: 'pause_league' | 'resume_league' | 'generate_rules_doc') {
    if (!canEdit || busy) return
    if (action === 'pause_league' && !window.confirm('Pause weekly Zombie automation for this league?')) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/zombie/commissioner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, action, reason: 'Commissioner action from Advanced settings' }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; status?: string }
      if (!res.ok) throw new Error(data.error || 'Action failed.')
      if (data.status) setStatus(data.status)
      setMessage(action === 'generate_rules_doc' ? 'Rules document regenerated.' : `League ${data.status}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="font-bold text-white">League lifecycle</h3>
        <p className="text-[12px] text-white/65">Current status: {status ?? 'Loading…'}</p>
        {status === 'active' && (
          <button type="button" disabled={!canEdit || busy} onClick={() => void run('pause_league')}
            className="min-h-[44px] rounded-lg bg-red-500/20 px-4 font-semibold text-red-100 disabled:opacity-50">
            Pause weekly automation
          </button>
        )}
        {status === 'paused' && (
          <button type="button" disabled={!canEdit || busy} onClick={() => void run('resume_league')}
            className="min-h-[44px] rounded-lg bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">
            Resume weekly automation
          </button>
        )}
      </section>
      <section className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="font-bold text-white">Rules document</h3>
        <p className="text-[12px] text-white/65">Refresh the league rules after a permitted setup change.</p>
        <button type="button" disabled={!canEdit || busy} onClick={() => void run('generate_rules_doc')}
          className="min-h-[44px] rounded-lg bg-white/10 px-4 font-semibold text-white disabled:opacity-50">
          Regenerate rules
        </button>
      </section>
      <p className="text-[12px] text-white/60">
        Use Overrides for audited manager status, item, and winnings changes. Settlement corrections are managed in Automation.
      </p>
      <p role="status" aria-live="polite" className="text-[12px] text-amber-200">{busy ? 'Working…' : message}</p>
    </div>
  )
}
