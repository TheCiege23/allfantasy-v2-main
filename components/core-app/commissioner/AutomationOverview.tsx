'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { automationOverviewMessages } from '@/lib/core-app/messages/automationOverview'
import type { AutomationOverviewView } from '@/lib/commissioner-hub/automationOverviewService'
import type { AutomationGroup, AutomationRow } from '@/lib/commissioner-hub/automationOverview'

/**
 * "What runs itself" (lib/commissioner-hub/automationOverview.ts) on the Commissioner Hub: every
 * automation in the league, whether it is on, and a link to its switch. Read-only; each switch stays
 * on its own card or settings page.
 */
const GROUPS: Array<[AutomationGroup, 'groupLineups' | 'groupDrafts' | 'groupFairness']> = [
  ['lineups', 'groupLineups'],
  ['drafts', 'groupDrafts'],
  ['fairness', 'groupFairness'],
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
  const m = useMessages(automationOverviewMessages)
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
    r.state === 'on' ? m.stateOn : r.state === 'needs_plan' ? m.stateNeedsPlan : m.stateOff

  return (
    <section id="ch-automation-overview" className="af-tw af-tw-panel" data-testid="automation-overview">
      <h2>{m.title}</h2>
      {view === null ? (
        <p role="status">{m.loading}</p>
      ) : (
        <>
          <p>
            {m.summary(on, rows.length)}
          </p>
          {GROUPS.map(([group, heading]) => {
            const inGroup = rows.filter((r) => r.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group}>
                <h3>{m[heading]}</h3>
                <ul>
                  {inGroup.map((r) => (
                    <li key={r.key} data-testid={`automation-${r.key}`} data-state={r.state}>
                      <strong>{es ? LABELS_ES[r.key] ?? r.label : r.label}</strong> · {stateText(r)}
                      {r.detail && !es ? ` · ${r.detail}` : ''}{' '}
                      {r.href.startsWith('#') ? <a href={r.href}>{m.change}</a> : <Link href={r.href}>{m.change}</Link>}
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
