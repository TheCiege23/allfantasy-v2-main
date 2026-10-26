'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { EliminatedLineupView } from '@/lib/eliminated-lineups/eliminatedLineupService'
import type { LineupStandard } from '@/lib/eliminated-lineups/eliminatedLineups'

/**
 * Lineup minimums for eliminated teams (lib/eliminated-lineups), on the Commissioner Hub. The rule is
 * AF Commissioner; the list of teams out of the race, and what each lineup is short of, is shown either
 * way so a commissioner can see what the rule would do before turning it on. The route enforces the
 * plan; this card only reflects what it was told.
 */

const REFUSED: Record<string, [string, string]> = {
  no_season: ['This league has no season schedule yet, so nobody is out of the race.', 'Esta liga aún no tiene calendario de temporada, así que nadie está eliminado.'],
  no_playoff_size: ['Set how many teams make the playoffs first: elimination is measured against the last playoff spot.', 'Primero fija cuántos equipos van a playoffs: la eliminación se mide contra el último puesto de playoffs.'],
}

export function EliminatedLineups({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, esText: string) => (es ? esText : en)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/eliminated-lineups`
  const [view, setView] = useState<EliminatedLineupView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [standard, setStandard] = useState<LineupStandard>('playable')
  const [autoFill, setAutoFill] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as EliminatedLineupView
      setView(body)
      if (body.supported) {
        setEnabled(Boolean(body.rule))
        setStandard(body.rule?.standard ?? 'playable')
        setAutoFill(body.rule ? body.rule.autoFill : true)
      }
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
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: enabled ? { enabled: true, standard, autoFill } : { enabled: false } }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(enabled ? t('Saved. The rule applies from the next hourly check.', 'Guardado. La regla aplica desde la próxima revisión, cada hora.') : t('Saved. The rule is off.', 'Guardado. La regla está desactivada.'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not save. Refresh and try again.', 'No se pudo guardar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(false)
    }
  }

  if (view && !view.supported && !REFUSED[view.reason]) return null

  return (
    <section id="ch-eliminated-lineups" className="af-tw af-tw-panel" data-testid="eliminated-lineups">
      <h2>{t('Lineup minimums for eliminated teams', 'Alineación mínima para equipos eliminados')}</h2>
      <p>
        {t(
          'A team out of the playoff race still plays teams that are not. With this rule on, its manager is told once a week when the lineup falls short, and AllFantasy can fill just the short slots from the team’s own bench before kickoff. Every fill shows in the league log.',
          'Un equipo fuera de la carrera por los playoffs sigue jugando contra equipos que sí están en ella. Con esta regla, su mánager recibe un aviso una vez por semana si la alineación queda corta, y AllFantasy puede cubrir solo esos puestos con la banca del propio equipo antes del inicio. Cada cambio aparece en el registro de la liga.',
        )}
      </p>
      {view === null && !message ? <p role="status">{t('Loading…', 'Cargando…')}</p> : null}
      {view && !view.supported ? <p>{t(...REFUSED[view.reason]!)}</p> : null}

      {view?.supported ? (
        <>
          {!view.available ? (
            <p data-testid="eliminated-lineups-plan">{t('This rule is part of the AF Commissioner plan. You can see which teams it would cover below.', 'Esta regla es parte del plan AF Commissioner. Abajo puedes ver a qué equipos cubriría.')}</p>
          ) : null}
          <fieldset disabled={busy || (!view.available && !view.rule)}>
            <label>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
              {t('Eliminated teams must start a full lineup', 'Los equipos eliminados deben alinear un equipo completo')}
            </label>
            {enabled ? (
              <>
                <label>
                  <input type="radio" name="eliminated-standard" checked={standard === 'filled'} onChange={() => setStandard('filled')} />{' '}
                  {t('No empty slots', 'Sin puestos vacíos')}
                </label>
                <label>
                  <input type="radio" name="eliminated-standard" checked={standard === 'playable'} onChange={() => setStandard('playable')} />{' '}
                  {t('No empty slots, byes or Out/IR starters', 'Sin puestos vacíos, descansos ni titulares Out/IR')}
                </label>
                <label>
                  <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFill(e.target.checked)} />{' '}
                  {t('Let AllFantasy fill the short slots from the bench', 'Que AllFantasy cubra los puestos cortos con la banca')}
                </label>
              </>
            ) : null}
            <button type="button" className="af-btn" onClick={() => void save()}>
              {busy ? t('Saving…', 'Guardando…') : t('Save', 'Guardar')}
            </button>
          </fieldset>

          <h3>{view.week != null ? t(`Out of the race · week ${view.week}`, `Fuera de la carrera · semana ${view.week}`) : t('Out of the race', 'Fuera de la carrera')}</h3>
          {view.teams.length === 0 ? (
            <p>{t(`Every team can still reach the top ${view.playoffTeams}.`, `Todos los equipos aún pueden llegar al top ${view.playoffTeams}.`)}</p>
          ) : (
            <ul>
              {view.teams.map((team) => (
                <li key={team.rosterId} data-testid="eliminated-lineups-team">
                  <strong>{team.teamName}</strong>{' '}
                  {team.reason === 'missed_playoffs' ? t('· missed the playoffs', '· no llegó a playoffs') : t('· cannot reach the playoff line', '· ya no puede clasificar')}{' '}
                  {team.text
                    ? t(`· short: ${team.text.en}`, `· le falta: ${team.text.es}`)
                    : team.shortfall
                      ? t('· lineup meets the standard', '· la alineación cumple')
                      : t('· lineup could not be read', '· no se pudo leer la alineación')}
                  {team.managedByAllFantasy ? t(' · AllFantasy sets this lineup (inactive manager mode)', ' · AllFantasy pone esta alineación (modo mánager inactivo)') : null}
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
