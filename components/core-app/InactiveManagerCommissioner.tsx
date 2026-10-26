'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

type AutopilotStyle = 'dynasty_owner' | 'win_now' | 'rebuild'

type Team = {
  rosterId: string
  teamName: string | null
  managerName: string | null
  status: 'active' | 'at_risk' | 'inactive' | 'unknown'
  managed: { since: string; byUserId: string; autopilot?: { style: AutopilotStyle; since: string } } | null
  suggested: boolean
}

/**
 * Inactive manager mode (lib/inactive-manager): the commissioner hands an away manager's lineup to
 * AllFantasy, which sets the projected-best lineup each week until the manager saves one themselves.
 * AllFantasy suggests the teams manager health calls inactive; only the commissioner turns it on.
 */
export function InactiveManagerCommissioner({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const t = (en: string, es: string) => (language === 'es' ? es : en)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/inactive-managers`
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [native, setNative] = useState(true)
  const [entitled, setEntitled] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as { native: boolean; autopilotEntitled?: boolean; teams: Team[] }
      setNative(body.native)
      setEntitled(Boolean(body.autopilotEntitled))
      setTeams(body.teams)
    } catch {
      setMessage(t('Commissioner permission or a connection is required.', 'Se requiere permiso del comisionado o conexión.'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (team: Team) => {
    setBusy(team.rosterId)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: team.rosterId, on: !team.managed }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(team.managed ? t('Stopped. The manager sets their own lineup again.', 'Detenido. El mánager vuelve a poner su alineación.') : t('On. AllFantasy will set this lineup within the hour.', 'Activado. AllFantasy pondrá esta alineación en menos de una hora.'))
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not save. Refresh and try again.', 'No se pudo guardar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(null)
    }
  }

  /** Chimmy autopilot (AF Commissioner): `style: null` takes it off and leaves lineup management running. */
  const setAutopilot = async (team: Team, style: AutopilotStyle | null) => {
    setBusy(team.rosterId)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: team.rosterId, autopilot: style }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(
        style
          ? t(
              'Chimmy is running this team: the lineup, plus a waiver claim when a starter cannot play. Trade offers to it are refused while it does.',
              'Chimmy dirige este equipo: la alineación y una reclamación de waivers cuando un titular no puede jugar. Se rechazan las ofertas de intercambio mientras tanto.',
            )
          : t('Autopilot off. AllFantasy still sets the lineup until you stop it.', 'Piloto automático apagado. AllFantasy sigue poniendo la alineación hasta que lo detengas.'),
      )
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : t('Could not save. Refresh and try again.', 'No se pudo guardar. Actualiza e inténtalo de nuevo.'))
    } finally {
      setBusy(null)
    }
  }
  const styleLabel = (style: AutopilotStyle) =>
    style === 'dynasty_owner'
      ? t('Play like a dynasty owner', 'Jugar como dueño dinastía')
      : style === 'win_now'
        ? t('Win now', 'Ganar ya')
        : t('Rebuild', 'Reconstruir')

  if (!native) return null
  const name = (team: Team) => team.teamName || team.managerName || t('Team', 'Equipo')
  const shown = (teams ?? []).filter((team) => team.managed || team.suggested)
  const others = (teams ?? []).filter((team) => !team.managed && !team.suggested)

  return (
    <section id="ch-inactive-managers" className="af-tw af-tw-panel" data-testid="inactive-manager-mode">
      <h2>{t('Inactive manager mode', 'Modo mánager inactivo')}</h2>
      <p>
        {t(
          "Hand an away manager's lineup to AllFantasy: it sets the projected-best lineup every week, from players whose games have not started. It stops by itself the moment the manager saves a lineup, and the league log shows every change. With AF Commissioner, Chimmy can run the whole team on autopilot, playing like a dynasty owner by default.",
          'Deja la alineación de un mánager ausente a AllFantasy: pone la mejor alineación proyectada cada semana, con jugadores cuyos partidos no han empezado. Se detiene sola cuando el mánager guarda una alineación, y el registro de la liga muestra cada cambio. Con AF Commissioner, Chimmy puede dirigir todo el equipo en piloto automático, jugando como dueño dinastía por defecto.',
        )}
      </p>
      {teams === null ? <p role="status">{t('Loading teams…', 'Cargando equipos…')}</p> : null}
      {teams && shown.length === 0 ? <p>{t('No team looks inactive right now.', 'Ningún equipo parece inactivo ahora.')}</p> : null}
      <ul>
        {shown.map((team) => (
          <li key={team.rosterId} data-testid="inactive-manager-team">
            <strong>{name(team)}</strong>{' '}
            {team.managed
              ? t(`· AllFantasy sets this lineup since ${new Date(team.managed.since).toLocaleDateString()}`, `· AllFantasy pone esta alineación desde el ${new Date(team.managed.since).toLocaleDateString()}`)
              : t('· Suggested: no activity for a while', '· Sugerido: sin actividad hace tiempo')}{' '}
            <button type="button" className="af-btn" disabled={busy !== null} onClick={() => void toggle(team)}>
              {busy === team.rosterId ? t('Saving…', 'Guardando…') : team.managed ? t('Stop', 'Detener') : t('Let AllFantasy set lineups', 'Que AllFantasy ponga alineaciones')}
            </button>
            <span className="af-tw-autopilot" data-testid="chimmy-autopilot">
              {entitled ? (
                <label>
                  {t('Chimmy autopilot', 'Piloto automático de Chimmy')}{' '}
                  <select
                    value={team.managed?.autopilot?.style ?? ''}
                    disabled={busy !== null}
                    onChange={(e) => void setAutopilot(team, (e.target.value || null) as AutopilotStyle | null)}
                  >
                    <option value="">{t('Off', 'Apagado')}</option>
                    <option value="dynasty_owner">{styleLabel('dynasty_owner')}</option>
                    <option value="win_now">{styleLabel('win_now')}</option>
                    <option value="rebuild">{styleLabel('rebuild')}</option>
                  </select>
                </label>
              ) : (
                <a href="/commissioner-upgrade?highlight=chimmy_autopilot">
                  {t('Let Chimmy run this team (AF Commissioner)', 'Que Chimmy dirija este equipo (AF Commissioner)')}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <details>
          <summary>{t('Other teams', 'Otros equipos')}</summary>
          <ul>
            {others.map((team) => (
              <li key={team.rosterId}>
                {name(team)}{' '}
                <button type="button" className="af-btn" disabled={busy !== null} onClick={() => void toggle(team)}>
                  {t('Let AllFantasy set lineups', 'Que AllFantasy ponga alineaciones')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
