'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { AutomationOverviewView } from '@/lib/commissioner-hub/automationOverviewService'
import type { AutomationGroup, AutomationRow } from '@/lib/commissioner-hub/automationOverview'

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

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/automation-overview`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: AutomationOverviewView) => live && setView(body))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [leagueId])

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
    </section>
  )
}
