'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { AutomationOverviewView } from '@/lib/commissioner-hub/automationOverviewService'
import type { AutomationGroup, AutomationRow } from '@/lib/commissioner-hub/automationOverview'
import type { AutomationPreset, PresetPlan } from '@/lib/commissioner-hub/automationPreset'

/**
 * "What runs itself" (lib/commissioner-hub/automationOverview.ts) on the Commissioner Hub: every
 * automation in the league, whether it is on, and a link to its switch. Read-only; each switch stays
 * on its own card or settings page.
 */
const GROUPS: Array<[AutomationGroup, string, string]> = [
  ['lineups', 'Lineups', 'Alineaciones'],
  ['drafts', 'Drafts', 'Drafts'],
  ['fairness', 'Fairness', 'Juego limpio'],
]

const LABELS_ES: Record<string, string> = {
  fill_empty_starters: 'Llenar puestos titulares vacíos antes del cierre',
  managed_teams: 'Equipos que maneja AllFantasy o Chimmy',
  auto_handover: 'Pasar un equipo sin actividad',
  eliminated_lineups: 'Alineación mínima para equipos eliminados',
  ir_auto_move: 'Sacar de IR a los jugadores sanos',
  draft_as_me: 'Picks perdidos hechos como drafta el mánager',
  rookie_draft_opens: 'El draft de novatos se abre solo',
  rookie_draft_starts: 'El draft de novatos empieza solo',
  live_rookie_order: 'Orden del draft de novatos siempre al día',
  tanking: 'Monitor anti-tanking',
  hold_flagged_trades: 'Retener cambios sospechosos para revisión',
  taxi_rules: 'Reglas del taxi squad aplicadas',
}

export function AutomationOverview({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, esText: string) => (es ? esText : en)
  const [view, setView] = useState<AutomationOverviewView | null>(null)
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<PresetPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const presetUrl = `/api/leagues/${encodeURIComponent(leagueId)}/automation-preset`

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/automation-overview`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setView((await r.json()) as AutomationOverviewView)
    } catch {
      setFailed(true)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  /** Show what a preset would change; nothing is saved until the commissioner confirms. */
  const ask = async (preset: AutomationPreset) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(`${presetUrl}?preset=${preset}`, { cache: 'no-store' })
      const body = (await r.json().catch(() => ({}))) as PresetPlan & { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setPreview(body)
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not load. Refresh and try again.', 'No se pudo cargar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await fetch(presetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: preview.preset }) })
      const body = (await r.json().catch(() => ({}))) as PresetPlan & { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(t(`Saved: ${body.changes.length} change${body.changes.length === 1 ? '' : 's'}. Every switch still works on its own.`, `Guardado: ${body.changes.length} cambio${body.changes.length === 1 ? '' : 's'}. Cada interruptor sigue funcionando por separado.`))
      setPreview(null)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not save. Refresh and try again.', 'No se pudo guardar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(false)
    }
  }

  if (failed || (view && !view.supported)) return null
  const rows = view?.supported ? view.rows : []
  const on = rows.filter((r) => r.state === 'on').length
  const stateText = (r: AutomationRow) =>
    r.state === 'on' ? t('On', 'Activo') : r.state === 'needs_plan' ? t('AF Commissioner', 'AF Commissioner') : t('Off', 'Apagado')

  return (
    <section id="ch-automation-overview" className="af-tw af-tw-panel" data-testid="automation-overview">
      <h2>{t('What runs itself', 'Lo que funciona solo')}</h2>
      {view === null ? (
        <p role="status">{t('Loading…', 'Cargando…')}</p>
      ) : (
        <>
          <p>
            {t(
              `${on} of ${rows.length} automations are on. Each switch is on its own card or settings page; follow the link to change it.`,
              `${on} de ${rows.length} automatizaciones están activas. Cada interruptor está en su propia tarjeta o página de ajustes; sigue el enlace para cambiarlo.`,
            )}
          </p>
          <p data-testid="automation-presets">
            <button type="button" className="af-btn" disabled={busy} onClick={() => void ask('recommended')} data-testid="preset-recommended">
              {t('Turn on the recommended setup', 'Activar la configuración recomendada')}
            </button>{' '}
            <button type="button" className="af-btn" disabled={busy} onClick={() => void ask('run_it')} data-testid="preset-run-it">
              {t('Run it for me', 'Que lo lleve AllFantasy')}
            </button>
          </p>
          {preview ? (
            <div data-testid="preset-preview">
              {preview.changes.length === 0 ? (
                <p>{t('Everything in this setup is already on.', 'Todo lo de esta configuración ya está activo.')}</p>
              ) : (
                <>
                  <p>{t('Saving will:', 'Al guardar:')}</p>
                  <ul>
                    {preview.changes.map((c) => (
                      <li key={c.label}>{c.label}</li>
                    ))}
                  </ul>
                </>
              )}
              {preview.needsPlan.length > 0 ? (
                <p>
                  {t('Needs AF Commissioner, so not included: ', 'Requiere AF Commissioner, así que no se incluye: ')}
                  {preview.needsPlan.join(', ')}.
                </p>
              ) : null}
              {preview.changes.length > 0 ? (
                <button type="button" className="af-btn" disabled={busy} onClick={() => void confirm()} data-testid="preset-confirm">
                  {busy ? t('Saving…', 'Guardando…') : t('Save', 'Guardar')}
                </button>
              ) : null}{' '}
              <button type="button" className="af-btn" disabled={busy} onClick={() => setPreview(null)}>
                {t('Cancel', 'Cancelar')}
              </button>
            </div>
          ) : null}
          {GROUPS.map(([group, en, esText]) => {
            const inGroup = rows.filter((r) => r.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group}>
                <h3>{t(en, esText)}</h3>
                <ul>
                  {inGroup.map((r) => (
                    <li key={r.key} data-testid={`automation-${r.key}`} data-state={r.state}>
                      <strong>{es ? LABELS_ES[r.key] ?? r.label : r.label}</strong> · {stateText(r)}
                      {r.detail && !es ? ` · ${r.detail}` : ''}{' '}
                      {r.href.startsWith('#') ? <a href={r.href}>{t('Change', 'Cambiar')}</a> : <Link href={r.href}>{t('Change', 'Cambiar')}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
