'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import { RefreshLineups } from '@/components/core-app/player-finder/RefreshLineups'
import { TriageLineupLinks } from '@/components/core-app/player-finder/TriageLineupLinks'
import { chipDetail, type GameDayTriage as Triage } from '@/lib/core-app/gameDayTriage'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { lockState } from '@/lib/core-app/lineupLock'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { playerRef } from '@/lib/core-app/playerRef'

/**
 * "GAME DAY · YOUR FLAGGED STARTERS" — the finder's home before a search.
 *
 * One row per flagged starter across every league you play: status, his lock
 * counting down, and one button per league he starts in that opens THAT league's
 * lineup screen (TriageLineupLinks). The name and face open his card, which has
 * the full picture. Soonest lock first; a player whose game has started sits
 * last, and loses his buttons, since nothing of his can move now.
 *
 * ⚠ THE BUTTONS LIVE ON THE ROW, NOT ONLY ON THE CARD. Before 2026-09-27 the whole
 * row was one link to the card, so a manager with a flagged starter in twenty
 * leagues made twenty round trips — the exact hour this screen exists to save.
 *
 * Spanish (2026-10-04): fixed copy is inline es/en; loader text (the readiness and bye chips, "reported …")
 * goes through `coreUiCopy`, and each lock through LockClock, which translates its own label.
 */

const TITLE = { en: 'Game day · your flagged starters', es: 'Día de partido · tus titulares señalados' }

export function GameDayTriage({ state, nowIso, leagueCount }: { state: SectionState<Triage>; nowIso: string; leagueCount: number }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  if (!state.available) {
    return (
      <section className="af-card af-pf-triage af-pf-triage--empty" aria-labelledby="af-pf-triage-h">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          {es ? TITLE.es : TITLE.en}
        </h3>
        <p className="af-pf-unavailable">{copy(state.reason)}.</p>
      </section>
    )
  }
  const { rows, week, leaguesRead } = state.data
  const bestBall = state.data.bestBallLeagues ?? 0
  const notRead = state.data.leaguesNotRead ?? 0
  const unsupported = state.data.unsupportedLeagues ?? 0
  const weekLabel = week ? (es ? `semana ${week.week}` : `week ${week.week}`) : es ? 'esta semana' : 'this week'
  const weekKey = week ? `${week.season}-${week.week}` : 'current'

  return (
    <section className="af-card af-pf-triage" aria-labelledby="af-pf-triage-h" data-count={rows.length}>
      <header className="af-pf-triage-head">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          {es ? TITLE.es : TITLE.en}
        </h3>
        {es ? (
          <span className="af-pf-triage-sub af-num">
            {leaguesRead} de {leagueCount} {leagueCount === 1 ? 'alineación leída' : 'alineaciones leídas'}
            {bestBall > 0 ? ` · ${bestBall} best ball ${bestBall === 1 ? 'omitida' : 'omitidas'}` : ''}
            {unsupported > 0 ? ` · ${unsupported} en una plataforma que todavía no podemos leer` : ''} · {weekLabel}
          </span>
        ) : (
          <span className="af-pf-triage-sub af-num">
            {leaguesRead} of {leagueCount} {leagueCount === 1 ? 'lineup' : 'lineups'} read
            {bestBall > 0 ? ` · ${bestBall} best ball skipped` : ''}
            {unsupported > 0 ? ` · ${unsupported} on a platform we can't read yet` : ''} · {weekLabel}
          </span>
        )}
      </header>
      <RefreshLineups asOf={state.data.rostersAsOf ?? null} nowIso={nowIso} />
      {notRead > 0 ? (
        <p className="af-pf-triage-warn" role="note">
          {es
            ? `${notRead} ${notRead === 1 ? 'liga no se leyó' : 'ligas no se leyeron'}: son más de las que esta lista revisa a la vez. Busca un jugador para ver todas las ligas en las que está.`
            : `${notRead} ${notRead === 1 ? 'league was' : 'leagues were'} not read — more than this list checks at once. Search a player to see every league he is in.`}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="af-pf-triage-clear">
          {es
            ? `No hay titulares señalados en tus alineaciones (${weekLabel}). Busca cualquier jugador arriba.`
            : `No flagged starters across your lineups ${weekLabel}. Search any player above.`}
        </p>
      ) : (
        <ul className="af-pf-triage-list">
          {rows.map((r) => {
            const href = `/core/players?q=${encodeURIComponent(r.player.name)}&player=${encodeURIComponent(playerRef(r.player.sport, r.player.externalId))}`
            const locked = r.kickoff ? lockState(r.kickoff, nowIso).state === 'locked' : false
            const detail = chipDetail(r.status?.label ?? null, r.description)
            const count = r.leagues.length
            return (
              <li key={`${r.player.sport}:${r.player.sleeperId}`} className="af-pf-triage-row" data-tone={r.status?.tone ?? 'none'} data-nogame={r.noGame ? 'true' : undefined} data-locked={locked ? 'true' : undefined}>
                <Link href={href} className="af-pf-triage-link">
                  <PlayerAvatar src={r.player.imageUrl} name={r.player.name} size={40} />
                  <span className="af-pf-triage-text">
                    <span className="af-pf-triage-name">
                      {r.player.name}
                      {r.status ? (
                        <span className="af-chip af-num af-pf-ready af-pf-triage-status" data-tone={r.status.tone}>
                          {copy(r.status.label)}
                          {detail ? ` · ${detail}` : ''}
                        </span>
                      ) : null}
                      {r.noGame ? (
                        <span className="af-chip af-num af-pf-ready af-pf-triage-status af-pf-bye" data-tone={r.bye ? 'bad' : 'warn'}>
                          {copy(r.bye ? (week ? `Bye · wk ${week.week}` : 'Bye') : 'No game on the schedule')}
                        </span>
                      ) : null}
                      {r.inactive ? (
                        <span className="af-pf-triage-when af-num">
                          {es
                            ? `declarado inactivo a las ${r.inactive.clock} · ${r.inactive.minutesBeforeKickoff} min antes del inicio`
                            : `declared inactive at ${r.inactive.clock} · ${r.inactive.minutesBeforeKickoff} min before kickoff`}
                        </span>
                      ) : reportedLabel(r.reportedAt, nowIso) ? (
                        <span className="af-pf-triage-when af-num">{copy(reportedLabel(r.reportedAt, nowIso)!)}</span>
                      ) : null}
                    </span>
                    <span className="af-pf-triage-meta">
                      {r.player.position ?? ''}
                      {r.player.team ? (
                        <>
                          {r.player.position ? ' · ' : ''}
                          <TeamLogo sport={r.player.sport} team={r.player.team} size={14} />
                          {r.player.team}
                        </>
                      ) : null}
                      {es
                        ? ` · titular en ${count} ${count === 1 ? 'liga' : 'ligas'}`
                        : ` · starting in ${count} ${count === 1 ? 'league' : 'leagues'}`}
                    </span>
                  </span>
                  <span className="af-pf-triage-lock">
                    {r.kickoff ? (
                      <LockClock kickoffIso={r.kickoff} nowIso={nowIso} />
                    ) : (
                      <span className="af-chip af-num af-pf-lock" data-lock="nogame">
                        {r.bye
                          ? es
                            ? 'siéntalo antes de que tus ligas se bloqueen'
                            : 'bench him before your leagues lock'
                          : es
                            ? 'sin hora de inicio para la cuenta regresiva'
                            : 'no kickoff to count down to'}
                      </span>
                    )}
                  </span>
                </Link>
                <TriageLineupLinks playerKey={r.player.sleeperId} playerName={r.player.name} leagues={r.leagues} weekKey={weekKey} locked={locked} />
              </li>
            )
          })}
        </ul>
      )}
      <p className="af-pf-triage-foot">
        {es
          ? 'Señalado significa que el reporte de lesiones dice Dudoso, Poco probable o Fuera, o que su equipo no juega esta semana: un descanso cuando la jornada tiene esa forma, y si no, un hueco en el calendario que tenemos. Las ligas best ball quedan fuera: la plataforma arma esas alineaciones sola. Cada bloqueo es el inicio de su propio partido; una liga que bloquea todas las alineaciones en el primer partido se bloquea antes. Un ✓ significa que abriste esa alineación aquí: no vemos el cambio que hagas en la plataforma hasta que se actualice su plantel.'
          : 'Flagged means the injury feed reads Questionable, Doubtful or Out, or his club is not playing this week — a bye when the slate has the shape of one, otherwise a gap in the schedule we hold. Best-ball leagues are left out: the platform picks those lineups itself. Locks are his own kickoff; a league that locks every lineup at the first game locks earlier. A ✓ means you opened that lineup here — we cannot see the change you make on the platform until its roster refreshes.'}
      </p>
    </section>
  )
}

export default GameDayTriage
