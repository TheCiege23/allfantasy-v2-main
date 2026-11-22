'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { IrAutoMoveView } from '@/lib/ir-activation/irAutoMoveService'

/**
 * IR auto-move (lib/ir-activation) on the Commissioner Hub: the switch, and every team with an
 * activated player still on IR, shown either way so a commissioner can see what the rule would do.
 * AF Commissioner; the route enforces the plan, this card only reflects what it was told. Strings:
 * commishHub.irAuto.* (EN/ES).
 */
const K = 'commishHub.irAuto.'

export function IrAutoMove({ leagueId }: { leagueId: string }) {
  const { t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/ir-auto-move`
  const [view, setView] = useState<IrAutoMoveView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as IrAutoMoveView
      setView(body)
      if (body.supported) setEnabled(body.enabled)
    } catch {
      setMessage(tx('loadFailed'))
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
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule: { enabled } }) })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(tx(enabled ? 'savedOn' : 'savedOff'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : tx('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (view && !view.supported) return null

  return (
    <section id="ch-ir-auto-move" className="af-tw af-tw-panel" data-testid="ir-auto-move">
      <h2>{tx('title')}</h2>
      <p>{tx('intro')}</p>
      {view === null && !message ? <p role="status">{tx('loading')}</p> : null}
      {view?.supported ? (
        <>
          {!view.available ? <p data-testid="ir-auto-move-plan">{tx('plan')}</p> : null}
          <fieldset disabled={busy || (!view.available && !view.enabled)}>
            <label>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="ir-auto-move-enabled" /> {tx('switch')}
            </label>
            <button type="button" className="af-btn" onClick={() => void save()} data-testid="ir-auto-move-save">
              {busy ? tx('saving') : tx('save')}
            </button>
          </fieldset>
          <h3>{view.week != null ? tx('listWeek', { week: view.week }) : tx('list')}</h3>
          {view.teams.length === 0 ? (
            <p>{tx('none')}</p>
          ) : (
            <ul>
              {view.teams.map((team) => (
                <li key={team.teamName} data-testid="ir-auto-move-team">
                  <strong>{team.teamName}</strong> · {team.players.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
