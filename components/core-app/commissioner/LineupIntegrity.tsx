'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LineupIntegrityReport } from '@/lib/lineup-integrity/lineupIntegrityService'

/**
 * Lineup-integrity card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 7), on the Commissioner Hub.
 * Evidence, not a verdict: it lists lineups that could not score so the commissioner can decide.
 */

type View = LineupIntegrityReport & { entitled: boolean }

const UNSUPPORTED: Record<string, [string, string]> = {
  unsupported_platform: [
    'Available for leagues run on AllFantasy and for Sleeper leagues. This league’s platform does not give AllFantasy each week’s starting lineup.',
    'Disponible para ligas de AllFantasy y de Sleeper. La plataforma de esta liga no le da a AllFantasy la alineación de cada semana.',
  ],
  not_nfl: ['Only NFL leagues have a weekly lineup lock to audit.', 'Solo las ligas de la NFL tienen un cierre semanal de alineación que auditar.'],
  best_ball: ['Best ball leagues set lineups automatically, so there is nothing to audit.', 'Las ligas best ball fijan la alineación solas, así que no hay nada que auditar.'],
  no_lineup_rules: ['This league’s starting slots could not be read, so empty slots cannot be counted.', 'No se pudieron leer los puestos titulares de esta liga, así que no se pueden contar los vacíos.'],
}

export function LineupIntegrity({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, spanish: string) => (es ? spanish : en)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // Never rejects: a failed read is a line on the card, not an unhandled error on the hub.
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/lineup-integrity`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) setView(body as View)
        else setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
  }, [leagueId])

  if (error) return <p className="af-ch-muted">{error}</p>
  if (!view) return <p className="af-ch-muted">{t('Loading…', 'Cargando…')}</p>
  if (!view.supported) {
    const copy = UNSUPPORTED[view.reason]
    return <p className="af-ch-recipe-desc">{copy ? t(copy[0], copy[1]) : view.reason}</p>
  }

  const flagged = view.findings.filter((f) => f.flagged)
  const soft = view.findings.filter((f) => !f.flagged)
  return (
    <div className="af-ch-recipes" data-testid="lineup-integrity">
      <p className="af-ch-recipe-desc">
        {view.latestWeek == null
          ? t('No finished week on file yet.', 'Todavía no hay ninguna semana terminada.')
          : view.fullSeason
            ? t(`Season ${view.season}, weeks ${view.weeks[0]}–${view.latestWeek}.`, `Temporada ${view.season}, semanas ${view.weeks[0]}–${view.latestWeek}.`)
            : t(`Week ${view.latestWeek}, the latest finished week.`, `Semana ${view.latestWeek}, la última terminada.`)}
      </p>

      {flagged.length === 0 && view.latestWeek != null && (
        <p className="af-ch-recipe-desc">{t('Every audited lineup could score: no empty slots and no starters on bye.', 'Todas las alineaciones auditadas podían sumar: sin puestos vacíos ni titulares en semana libre.')}</p>
      )}
      {flagged.length > 0 && (
        <ul className="af-ch-recipe-list">
          {flagged.map((f) => (
            <li key={`${f.rosterId}-${f.week}`} data-on="true">
              <p className="af-ch-recipe-desc">{f.text}</p>
            </li>
          ))}
        </ul>
      )}
      {soft.length > 0 && (
        <>
          <p className="af-ch-recipe-label" style={{ marginTop: 12 }}>{t('Leads to check', 'Pistas para revisar')}</p>
          <ul className="af-ch-recipe-list">
            {soft.map((f) => (
              <li key={`soft-${f.rosterId}-${f.week}`}>
                <p className="af-ch-recipe-desc">{f.text}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {view.summary && view.summary.some((s) => s.weeksFlagged > 0) && (
        <table className="w-full text-sm" style={{ marginTop: 12 }}>
          <thead>
            <tr className="text-left text-white/60">
              <th>{t('Team', 'Equipo')}</th>
              <th>{t('Weeks flagged', 'Semanas marcadas')}</th>
              <th>{t('Empty slots', 'Puestos vacíos')}</th>
              <th>{t('Bye starters', 'Titulares en semana libre')}</th>
            </tr>
          </thead>
          <tbody>
            {view.summary
              .filter((s) => s.weeksFlagged > 0)
              .map((s) => (
                <tr key={s.rosterId}>
                  <td>{s.teamName}</td>
                  <td>
                    {s.weeksFlagged} / {s.weeksAudited}
                  </td>
                  <td>{s.emptySlots}</td>
                  <td>{s.byeStarts}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {!view.entitled && (
        <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>
          {t('The full-season record, team by team, is part of the AF Commissioner plan.', 'El historial de toda la temporada, equipo por equipo, es parte del plan AF Commissioner.')}
        </p>
      )}
      <p className="af-ch-recipe-meta" style={{ marginTop: 8 }}>{view.basis}</p>
    </div>
  )
}
