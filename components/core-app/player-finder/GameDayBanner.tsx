'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { AppLinkHint } from '@/components/core-app/player-finder/AppLinkHint'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import type { PlayerGame } from '@/lib/core-app/playerGame'
import { kickoffClock, lockState } from '@/lib/core-app/lineupLock'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { designationText } from '@/lib/core-app/playerFinderCopy'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { inactiveSentence, type PregameInactive } from '@/lib/core-app/pregameInactive'
import { platformLabel, type PlatformLink } from '@/lib/core-app/platformLinks'

/**
 * The game-day header: an at-risk, ruled-out or not-playing player, his
 * kickoff (or his bye), the lock counting down, when the feed said it, and
 * one Open-lineup button per league where he is in your starting lineup — at
 * the top of the card, where a thumb lands at kickoff minus twenty.
 *
 * AllFantasy cannot write a lineup. The button opens that league's lineup
 * screen on its own platform (verified formats only — an unverified one opens
 * the league page, labelled as such), and the change is made there.
 *
 * Rendered when the injury feed says Questionable / Doubtful / Out and a
 * kickoff is on the schedule, OR when his club is not playing this week (a bye
 * by the slate's shape, or simply absent from the schedule — byeStatus.ts keeps
 * those apart). A healthy player with a game has no banner: the rows still
 * carry their lock, the header still carries his status.
 *
 * Spanish (2026-10-04): the summary is built in the reader's language here; what the loaders hand over
 * in English (the readiness chip, the bye chip, "reported …", the inactive line) goes through
 * `coreUiCopy`, and the kickoff clock through `kickoffText`. The provider starts at English on server
 * and client alike, so the first paint agrees.
 */

export type GameDayLeague = {
  leagueId: string
  leagueName: string
  platform: string
  link: PlatformLink | null
}

export function GameDayBanner({
  playerName,
  status,
  detail,
  reportedAt = null,
  game,
  bye = null,
  inactive = null,
  nowIso,
  starting,
  benched,
  elsewhere,
}: {
  playerName: string
  /** The readiness chip; null when the feed holds no report (a bye banner can still render). */
  status: { label: string; tone: string } | null
  /** The injury description, when short enough to sit beside the status. */
  detail: string | null
  /** When the feed said it, ISO. */
  reportedAt?: string | null
  /** His game this week; null when his club is not playing. */
  game: PlayerGame | null
  /** The not-playing chip — "Bye · wk 9" or "No game on the schedule" — with which claim it is. */
  bye?: { label: string; tone: 'bad' | 'warn'; kind: 'bye' | 'no-game' } | null
  /** Ruled Out inside the pregame window — the inactive list or a late scratch (pregameInactive.ts). Leads the summary. */
  inactive?: PregameInactive | null
  nowIso: string
  /** Leagues where he is in YOUR starting lineup. */
  starting: GameDayLeague[]
  /** Leagues where he is yours but not starting. */
  benched: number
  /** Leagues where someone else has him. */
  elsewhere: number
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const copy = (english: string) => coreUiCopy(english, language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName
  const n = starting.length
  const leagues = (k: number) => (es ? `${k} ${k === 1 ? 'liga' : 'ligas'}` : `${k} ${k === 1 ? 'league' : 'leagues'}`)
  // Once his game has started nothing of his can move on any platform; say so instead of offering buttons.
  const locked = game ? lockState(game.kickoff, nowIso).state === 'locked' : false
  const reported = reportedLabel(reportedAt, nowIso)

  let summary: string
  if (es) {
    if (bye && !game) {
      const lede = bye.kind === 'bye' ? 'Descansa esta semana' : 'No tiene partido en el calendario esta semana'
      summary =
        n > 0
          ? `${lede}: ${last} está en tu alineación titular en ${leagues(n)}; siéntalo antes de que esas alineaciones se bloqueen.`
          : benched > 0
            ? `${lede}: está en tu banca en ${leagues(benched)}; no hay nada que mover.`
            : elsewhere > 0
              ? `${lede}: no está en ninguno de tus equipos; otro mánager lo tiene en ${leagues(elsewhere)}.`
              : `${lede}: no está en ningún equipo que leamos.`
    } else if (locked) {
      summary =
        n > 0
          ? `Su partido ya empezó: ${last} está bloqueado en tu alineación en ${leagues(n)}; ya no se puede mover nada.`
          : 'Su partido ya empezó: ya no se puede mover nada suyo.'
    } else if (n > 0) {
      summary = `Titular en ${n} de tus ligas: mueve a ${last} antes del inicio.`
    } else if (benched > 0) {
      summary = `En tu banca en ${leagues(benched)}: no hay nada que mover antes del inicio.`
    } else if (elsewhere > 0) {
      summary = `No está en ninguno de tus equipos: otro mánager lo tiene en ${leagues(elsewhere)}.`
    } else {
      summary = 'No está en ningún equipo que leamos.'
    }
  } else if (bye && !game) {
    const lede = bye.kind === 'bye' ? 'On bye this week' : 'No game on the schedule for him this week'
    summary =
      n > 0
        ? `${lede} — ${last} is in your starting lineup in ${leagues(n)}; bench him before those lineups lock.`
        : benched > 0
          ? `${lede} — on your bench in ${leagues(benched)}; nothing to move.`
          : elsewhere > 0
            ? `${lede} — not on any of your rosters; someone else has him in ${leagues(elsewhere)}.`
            : `${lede} — not on any roster we read.`
  } else if (locked) {
    summary = n > 0 ? `His game has kicked off — ${last} is locked in your lineup in ${leagues(n)}; nothing can move now.` : 'His game has kicked off — nothing of his can move now.'
  } else if (n > 0) {
    summary = `Starting in ${n} of your ${n === 1 ? 'league' : 'leagues'} — move ${last} before kickoff.`
  } else if (benched > 0) {
    summary = `On your bench in ${leagues(benched)} — nothing to move before kickoff.`
  } else if (elsewhere > 0) {
    summary = `Not on any of your rosters — someone else has him in ${leagues(elsewhere)}.`
  } else {
    summary = 'Not on any roster we read.'
  }

  // The inactive announcement leads: it is the one fact that changed in the last two hours.
  if (inactive && game) summary = `${copy(inactiveSentence(inactive))}. ${summary}`
  const tone = bye && !game ? bye.tone : (status?.tone ?? 'warn')

  return (
    <section className="af-pf-gameday" data-tone={tone} data-kind={bye && !game ? bye.kind : 'game'} data-inactive={inactive && game ? 'true' : undefined} aria-label={es ? 'Día de partido' : 'Game day'}>
      <div className="af-pf-gameday-top">
        {status ? (
          <span className="af-chip af-num af-pf-ready" data-tone={status.tone}>
            {/* One player's designation: «Inactivo», not coreUiCopy's plural column heading «Inactivos».
                designationText falls back to coreUiCopy for every other label. */}
            {designationText(status.label, language)}
            {detail ? ` · ${detail}` : ''}
          </span>
        ) : null}
        {bye && !game ? (
          <span className="af-chip af-num af-pf-ready af-pf-bye" data-tone={bye.tone}>
            {copy(bye.label)}
          </span>
        ) : null}
        {game ? (
          <span className="af-pf-gameday-game af-num">
            {game.home ? 'vs' : '@'} {game.opponent} · {kickoffText(kickoffClock(game.kickoff), language)}
            {game.preseason ? (es ? ' · pretemporada' : ' · preseason') : ''}
          </span>
        ) : null}
        {reported ? <span className="af-pf-gameday-when af-num">{copy(reported)}</span> : null}
        {game ? <LockClock kickoffIso={game.kickoff} nowIso={nowIso} big /> : null}
      </div>
      <p className="af-pf-gameday-sum">{summary}</p>
      {n > 0 && !locked ? (
        <div className="af-pf-gameday-actions">
          {starting.map((l) =>
            l.link ? (
              l.link.external ? (
                <a key={l.leagueId} className="af-btn af-pf-gameday-btn" href={l.link.href} target="_blank" rel="noopener noreferrer" data-screen={l.link.screen}>
                  {/* `screen` is the human label ("Lineup", "League") — an unverified format lands on the league page and says so. */}
                  {es
                    ? l.link.screen === 'Lineup'
                      ? `Abrir la alineación en ${l.link.platformLabel}`
                      : `Abrir en ${l.link.platformLabel} · ${copy(l.link.screen)}`
                    : l.link.screen === 'Lineup'
                      ? `Open lineup in ${l.link.platformLabel}`
                      : `${l.link.label} · ${l.link.screen}`}
                  <small>{l.leagueName}</small>
                  {/* On a phone: whether this tap lands in the platform's app — measured per platform and screen (nativeApp.ts). */}
                  <AppLinkHint platform={l.platform} screen={l.link.screen} />
                </a>
              ) : (
                <Link key={l.leagueId} className="af-btn af-pf-gameday-btn" href={l.link.href} data-screen={l.link.screen}>
                  {es ? `Abrir en ${l.link.platformLabel}` : l.link.label}
                  <small>{l.leagueName}</small>
                </Link>
              )
            ) : (
              <Link key={l.leagueId} className="af-btn af-btn--ghost af-pf-gameday-btn" href={`/core?league=${encodeURIComponent(l.leagueId)}`}>
                {es ? 'Abrir' : 'Open'} {l.leagueName}
                <small>
                  {platformLabel(l.platform)} · {es ? 'sin enlace a la alineación registrado' : 'no lineup link on file'}
                </small>
              </Link>
            ),
          )}
        </div>
      ) : null}
    </section>
  )
}

export default GameDayBanner
