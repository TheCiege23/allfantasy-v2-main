'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { playerFinderMessages } from '@/lib/core-app/messages/playerFinder'
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
 * Spanish (2026-10-04): fixed copy is in the catalog (lib/core-app/messages/playerFinder.ts); loader text (the readiness and bye chips, "reported …")
 * goes through `coreUiCopy`, and each lock through LockClock, which translates its own label.
 */

export function GameDayTriage({ state, nowIso, leagueCount }: { state: SectionState<Triage>; nowIso: string; leagueCount: number }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(playerFinderMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  if (!state.available) {
    return (
      <section className="af-card af-pf-triage af-pf-triage--empty" aria-labelledby="af-pf-triage-h">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          {m.triageTitle}
        </h3>
        <p className="af-pf-unavailable">{copy(state.reason)}.</p>
      </section>
    )
  }
  const { rows, week, leaguesRead } = state.data
  const bestBall = state.data.bestBallLeagues ?? 0
  const notRead = state.data.leaguesNotRead ?? 0
  const unsupported = state.data.unsupportedLeagues ?? 0
  const weekLabel = week ? m.triageWeek(week.week) : m.triageThisWeek
  const weekKey = week ? `${week.season}-${week.week}` : 'current'

  return (
    <section className="af-card af-pf-triage" aria-labelledby="af-pf-triage-h" data-count={rows.length}>
      <header className="af-pf-triage-head">
        <h3 className="af-label af-pf-triage-title" id="af-pf-triage-h">
          {m.triageTitle}
        </h3>
        <span className="af-pf-triage-sub af-num">
          {m.triageRead(leaguesRead, leagueCount)}
          {bestBall > 0 ? m.triageBestBall(bestBall) : ''}
          {unsupported > 0 ? m.triageUnsupported(unsupported) : ''} · {weekLabel}
        </span>
      </header>
      <RefreshLineups asOf={state.data.rostersAsOf ?? null} nowIso={nowIso} />
      {notRead > 0 ? (
        <p className="af-pf-triage-warn" role="note">
          {m.triageNotRead(notRead)}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="af-pf-triage-clear">
          {m.triageClear(weekLabel)}
        </p>
      ) : (
        <ul className="af-pf-triage-list">
          {rows.map((r) => {
            const href = `/core/players?q=${encodeURIComponent(r.player.name)}&player=${encodeURIComponent(playerRef(r.player.sport, r.player.externalId, r.player.source))}`
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
                          {m.triageInactive(r.inactive.clock, r.inactive.minutesBeforeKickoff)}
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
                      {m.triageStartingIn(count)}
                    </span>
                  </span>
                  <span className="af-pf-triage-lock">
                    {r.kickoff ? (
                      <LockClock kickoffIso={r.kickoff} nowIso={nowIso} />
                    ) : (
                      <span className="af-chip af-num af-pf-lock" data-lock="nogame">
                        {r.bye ? m.triageBenchBeforeLock : m.triageNoKickoff}
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
        {m.triageFoot}
      </p>
    </section>
  )
}

export default GameDayTriage
