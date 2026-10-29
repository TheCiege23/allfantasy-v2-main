'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { FillEmptyStartersView } from '@/lib/lineup-automation/fillEmptyStartersService'

/**
 * Fill an empty starting spot before lock (lib/lineup-automation/fillEmptyStarters.ts) on the
 * Commissioner Hub: free, on by default, and this is the switch to turn it off. Hidden in a league that
 * cannot use it (imported, daily or automatic lineups).
 */
export function FillEmptyStarters({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t = (en: string, es: string) => (language === 'es' ? es : en)
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
      setMessage(t('Commissioner permission or a connection is required.', 'Se requiere permiso del comisionado o conexión.'))
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
      setMessage(on ? t('Saved. Empty spots are filled from the next hourly check.', 'Guardado. Los puestos vacíos se llenan desde la próxima revisión, cada hora.') : t('Saved. AllFantasy will leave empty spots empty.', 'Guardado. AllFantasy dejará vacíos los puestos vacíos.'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not save. Refresh and try again.', 'No se pudo guardar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(false)
    }
  }

  if (view && !view.supported) return null

  return (
    <section id="ch-fill-empty-starters" className="af-tw af-tw-panel" data-testid="fill-empty-starters">
      <h2>{t('Fill empty starting spots', 'Llenar puestos titulares vacíos')}</h2>
      <p>
        {t(
          'An empty starting spot scores nothing. Before lock, AllFantasy puts the best bench player who can play into any spot a team left empty. It never moves a player the manager started, and when nobody on the bench can play a spot, you are told instead. Lineups saved in the last three hours are left alone.',
          'Un puesto titular vacío no suma puntos. Antes del cierre, AllFantasy pone al mejor suplente que pueda jugar en cualquier puesto que un equipo dejó vacío. Nunca mueve a un jugador que el mánager puso de titular y, si nadie en la banca puede ocupar un puesto, se te avisa. Las alineaciones guardadas en las últimas tres horas no se tocan.',
        )}
      </p>
      {view === null && !message ? <p role="status">{t('Loading…', 'Cargando…')}</p> : null}
      {view?.supported ? (
        <fieldset disabled={busy}>
          <label>
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-testid="fill-empty-starters-on" />{' '}
            {t('Fill empty starting spots before lock', 'Llenar puestos titulares vacíos antes del cierre')}
          </label>
          <button type="button" className="af-btn" onClick={() => void save()} data-testid="fill-empty-starters-save">
            {busy ? t('Saving…', 'Guardando…') : t('Save', 'Guardar')}
          </button>
        </fieldset>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
