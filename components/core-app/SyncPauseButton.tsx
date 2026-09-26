'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncPauseButton({ leagueId, paused }: { leagueId: string; paused: boolean }) {
  const router = useRouter()
  const [savedPaused, setSavedPaused] = useState(paused)
  useEffect(() => { setSavedPaused(paused) }, [paused])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/core/sync/preference', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, paused: !savedPaused }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || 'Your preference could not be saved.')
      setSavedPaused(result.paused)
      router.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Your preference could not be saved.') }
    finally { setSaving(false) }
  }
  return <div>
    <button type="button" className="af-btn" disabled={saving} onClick={save} style={{ minHeight: 44 }}>
      {saving ? 'Saving…' : savedPaused ? 'Resume account sync' : 'Pause account sync'}
    </button>
    <p className="af-sy-sub">{savedPaused ? 'Excluded from your account’s Sync now and sidebar score refresh. History stays available.' : 'Pause an inactive league to stop your account’s Sync now and sidebar score refresh for this connection.'} Other members’ syncs and shared scheduled collection are unaffected.</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
