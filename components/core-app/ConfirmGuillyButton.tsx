'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * One tap for a commissioner to confirm an imported league is Guilly, from the Sync screen's Guilly card
 * (components/core-app/screens/LeagueSync.tsx). It records the same confirmation as the league-type
 * prompt — `PATCH /api/leagues/[leagueId]/league-type`, commissioner-only — so the card, the Guilly tab
 * and the rankings all stop treating the format as a guess.
 */
export default function ConfirmGuillyButton({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'guillotine' }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'The league type could not be saved.')
      setDone(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The league type could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (done) return <p className="af-sy-sub" role="status">Confirmed as a Guilly league.</p>
  return (
    <div data-testid="league-sync-guilly-confirm">
      <button type="button" className="af-btn" disabled={saving} onClick={confirm} style={{ minHeight: 44 }}>
        {saving ? 'Saving…' : 'Yes, this is a Guilly league'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}
