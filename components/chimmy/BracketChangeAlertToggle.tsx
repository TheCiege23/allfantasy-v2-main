'use client'

import { useEffect, useState } from 'react'
import { trackChimmyAIEvent } from '@/lib/chimmy-chat/analytics-events-client'

export function BracketChangeAlertToggle({ format, entryId }: {
  format: 'tournament' | 'world_cup' | 'playoff'; entryId: string
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setEnabled(null)
    setError('')
    const query = new URLSearchParams({ format, entryId })
    fetch(`/api/chimmy/bracket-alerts?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load alert setting')
        return response.json() as Promise<{ enabled: boolean }>
      })
      .then((value) => { if (active) setEnabled(value.enabled === true) })
      .catch(() => { if (active) setError('Alert setting unavailable') })
    return () => { active = false }
  }, [format, entryId])

  async function toggle() {
    if (enabled == null || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/chimmy/bracket-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, entryId, enabled: !enabled }),
      })
      if (!response.ok) throw new Error('Could not save alert setting')
      const result = await response.json() as { enabled: boolean }
      setEnabled(result.enabled === true)
      void trackChimmyAIEvent({ event_name: 'bracket_alert_opt_in', surface: 'chimmy_chat',
        action: result.enabled === true ? 'enabled' : 'disabled', timestamp: new Date().toISOString(),
        metadata: { format } })
    } catch {
      setError('Could not save alert setting')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 text-xs" data-testid="bracket-change-alert-setting">
      <button type="button" role="switch" aria-checked={enabled === true} disabled={enabled == null || busy}
        onClick={toggle} className="rounded-lg border border-current/30 px-2.5 py-1.5 font-semibold disabled:opacity-50">
        {enabled == null ? 'Loading bracket alerts…' : enabled ? 'Result alerts on' : 'Get result alerts'}
      </button>
      <span className="ml-2 opacity-70">Opt in to score or decided-pick changes. In-app and push delivery follow your bracket notification settings.</span>
      {error ? <span role="alert" className="ml-2 text-red-400">{error}</span> : null}
    </div>
  )
}
