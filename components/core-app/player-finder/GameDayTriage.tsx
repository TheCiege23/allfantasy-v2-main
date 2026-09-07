import Link from 'next/link'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import type { GameDayTriage as Triage } from '@/lib/core-app/gameDayTriage'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { playerRef } from '@/lib/core-app/playerRef'

/**
 * "GAME DAY · YOUR FLAGGED STARTERS" — the finder's home before a search.
 *
 * One row per flagged starter across every league you play: status, the
 * leagues he starts in, his lock counting down. The whole row opens his card,
 * which leads with the game-day banner and the Open-lineup buttons. Soonest
 * lock first; a player whose game has started sits last, since nothing of his
 * can move now.
 */

export function GameDayTriage({ state, nowIso, leagueCount }: { state: SectionState<Triage>; nowIso: string; leagueCount: number }) {
  if (!state.available) {
    return (
      <section className="af-card af-pf-triage af-pf-triage--empty" aria-labelledby="af-pf-triage-h">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          Game day · your flagged starters
        </h3>
        <p className="af-pf-unavailable">{state.reason}.</p>
      </section>
    )
  }
  const { rows, week, leaguesRead } = state.data
  const weekLabel = week ? `week ${week.week}` : 'this week'

  return (
    <section className="af-card af-pf-triage" aria-labelledby="af-pf-triage-h" data-count={rows.length}>
      <header className="af-pf-triage-head">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          Game day · your flagged starters
        </h3>
        <span className="af-pf-triage-sub af-num">
          {leaguesRead} of {leagueCount} {leagueCount === 1 ? 'lineup' : 'lineups'} read · {weekLabel}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="af-pf-triage-clear">No flagged starters across your lineups {weekLabel}. Search any player above.</p>
      ) : (
        <ul className="af-pf-triage-list">
          {rows.map((r) => {
            const href = `/core/players?q=${encodeURIComponent(r.player.name)}&player=${encodeURIComponent(playerRef(r.player.sport, r.player.externalId))}`
            return (
              <li key={r.player.sleeperId} className="af-pf-triage-row" data-tone={r.status?.tone ?? 'none'} data-nogame={r.noGame ? 'true' : undefined}>
                <Link href={href} className="af-pf-triage-link">
                  <PlayerAvatar src={r.player.imageUrl} name={r.player.name} size={40} />
                  <span className="af-pf-triage-text">
                    <span className="af-pf-triage-name">
                      {r.player.name}
                      {r.status ? (
                        <span className="af-chip af-num af-pf-ready af-pf-triage-status" data-tone={r.status.tone}>
                          {r.status.label}
                          {r.description && r.description.length <= 20 ? ` · ${r.description}` : ''}
                        </span>
                      ) : null}
                      {r.noGame ? (
                        <span className="af-chip af-num af-pf-ready af-pf-triage-status af-pf-bye" data-tone={r.bye ? 'bad' : 'warn'}>
                          {r.bye ? (week ? `Bye · wk ${week.week}` : 'Bye') : 'No game on the schedule'}
                        </span>
                      ) : null}
                      {r.inactive ? (
                        <span className="af-pf-triage-when af-num">{`declared inactive at ${r.inactive.clock} · ${r.inactive.minutesBeforeKickoff} min before kickoff`}</span>
                      ) : reportedLabel(r.reportedAt, nowIso) ? (
                        <span className="af-pf-triage-when af-num">{reportedLabel(r.reportedAt, nowIso)}</span>
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
                      {' · starting in '}
                      {r.leagues.map((l) => `${l.leagueName} · ${platformLabel(l.platform)}`).join(', ')}
                    </span>
                  </span>
                  <span className="af-pf-triage-lock">
                    {r.kickoff ? (
                      <LockClock kickoffIso={r.kickoff} nowIso={nowIso} />
                    ) : (
                      <span className="af-chip af-num af-pf-lock" data-lock="nogame">
                        {r.bye ? 'bench him before your leagues lock' : 'no kickoff to count down to'}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <p className="af-pf-triage-foot">
        Flagged means the injury feed reads Questionable, Doubtful or Out, or his club is not playing this week — a bye when the slate has the shape of one, otherwise a gap in the schedule we hold. Locks are his own kickoff; a league that locks every lineup at the first game locks earlier.
      </p>
    </section>
  )
}

export default GameDayTriage
