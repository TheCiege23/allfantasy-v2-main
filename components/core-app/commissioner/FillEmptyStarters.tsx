'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import type { FillEmptyStartersView } from '@/lib/lineup-automation/fillEmptyStartersService'

/**
 * Fill an empty starting spot before lock (lib/lineup-automation/fillEmptyStarters.ts) on the
 * Commissioner Hub: free, on by default, and this is the switch to turn it off. Hidden in a league that
 * cannot use it (imported, daily or automatic lineups).
 */
export function FillEmptyStarters({ leagueId }: { leagueId: string }) {
  const m = useMessages(commissionerScreensMessages)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/fill-empty-starters`
  const [view, setView] = useState<FillEmptyStartersView | null>(null)
  const [on, setOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as FillEmptyStartersView
      setView(body)
      if (body.supported) setOn(body.on)
    } catch {
      setMessage(m.commonPermissionRequired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(on ? m.fillStartersSavedOn : m.fillStartersSavedOff)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.commonCouldNotSaveRefresh)
    } finally {
      setBusy(false)
    }
  }

  if (view && !view.supported) return null

  return (
    <section id="ch-fill-empty-starters" className="af-tw af-tw-panel" data-testid="fill-empty-starters">
      <h2>{m.fillStartersTitle}</h2>
      <p>
        {m.fillStartersDesc}
      </p>
      {view === null && !message ? <p role="status">{m.commonLoading}</p> : null}
      {view?.supported ? (
        <fieldset disabled={busy}>
          <label>
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="fill-empty-starters-on" />{' '}
            {m.fillStartersToggle}
          </label>
          <button type="button" className="af-btn" onClick={() => void save()} data-testid="fill-empty-starters-save">
            {busy ? m.commonSaving : m.commonSave}
          </button>
        </fieldset>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
