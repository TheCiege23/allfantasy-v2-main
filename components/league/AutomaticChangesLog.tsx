'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { AutomaticChangeRow } from '@/lib/lineup-automation/automaticChangeUndoService'

/**
 * The league log of automatic lineup changes, with Undo (lib/lineup-automation/automaticChangeUndo.ts).
 * The owner sees their own team's, the commissioner every team's. Undo is offered only on the latest
 * change to a lineup nobody has touched since; the server checks that again, and that no moved player's
 * game has started. Hidden when there is nothing in the last 14 days.
 */
export function AutomaticChangesLog({ leagueId, className, onUndone }: { leagueId: string; className?: string; onUndone?: () => void }) {
  const { language } = useOptionalLanguage()
  const t = (en: string, es: string) => (language === 'es' ? es : en)
  const [rows, setRows] = useState<AutomaticChangeRow[] | null>(null)
  const [commissioner, setCommissioner] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/automatic-changes`

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const body = r.ok ? ((await r.json()) as { rows: AutomaticChangeRow[]; commissioner: boolean }) : null
      setRows(body?.rows ?? [])
      setCommissioner(Boolean(body?.commissioner))
    } catch {
      setRows([])
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  async function undo(id: string) {
    setBusy(id)
    setMessage(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auditId: id }) })
      const body = (await r.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(t('Undone — the players are back where they were.', 'Deshecho: los jugadores volvieron a donde estaban.'))
      onUndone?.()
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not undo. Refresh and try again.', 'No se pudo deshacer. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(null)
    }
  }

  if (!rows || rows.length === 0) return null
  return (
    <details className={className} data-testid="automatic-changes-log">
      <summary>{t('Recent automatic changes', 'Cambios automáticos recientes')}</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.id} data-testid={`automatic-change-${r.id}`}>
            <span>
              {new Date(r.at).toLocaleDateString(language === 'es' ? 'es' : 'en', { month: 'short', day: 'numeric' })}
              {commissioner && r.teamName ? ` · ${r.teamName}` : ''} — {r.message}
            </span>{' '}
            {r.undone ? (
              <em>{t('Undone', 'Deshecho')}</em>
            ) : r.undoable ? (
              <button type="button" className="af-btn" disabled={busy !== null} onClick={() => void undo(r.id)} data-testid={`undo-${r.id}`}>
                {busy === r.id ? t('Undoing…', 'Deshaciendo…') : t('Undo', 'Deshacer')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="nls-muted">
        {t(
          'Undo is offered on the latest change while the lineup is untouched since and no moved player’s game has started.',
          'Puedes deshacer el último cambio mientras la alineación siga igual y no haya empezado el partido de ningún jugador movido.',
        )}
      </p>
      {message ? <p role="status">{message}</p> : null}
    </details>
  )
}
