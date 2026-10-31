'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { playerFinderMessages } from '@/lib/core-app/messages/playerFinder'
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
 * Spanish (2026-10-04): the summary is built in the reader's language from the catalog (lib/core-app/messages/playerFinder.ts); what the loaders hand over
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
  const m = useMessages(playerFinderMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName
  const n = starting.length
  // Once his game has started nothing of his can move on any platform; say so instead of offering buttons.
  const locked = game ? lockState(game.kickoff, nowIso).state === 'locked' : false
  const reported = reportedLabel(reportedAt, nowIso)

  let summary: string
  if (bye && !game) {
    const lede = bye.kind === 'bye' ? m.bannerByeLede : m.bannerNoGameLede
    summary =
      n > 0
        ? m.bannerByeStarting(lede, last, n)
        : benched > 0
          ? m.bannerByeBench(lede, benched)
          : elsewhere > 0
            ? m.bannerByeElsewhere(lede, elsewhere)
            : m.bannerByeNone(lede)
  } else if (locked) {
    summary = n > 0 ? m.bannerLockedStarting(last, n) : m.bannerLockedNone
  } else if (n > 0) {
    summary = m.bannerStarting(n, last)
  } else if (benched > 0) {
    summary = m.bannerBench(benched)
  } else if (elsewhere > 0) {
    summary = m.bannerElsewhere(elsewhere)
  } else {
    summary = m.bannerNone
  }

  // The inactive announcement leads: it is the one fact that changed in the last two hours.
  if (inactive && game) summary = `${copy(inactiveSentence(inactive))}. ${summary}`
  const tone = bye && !game ? bye.tone : (status?.tone ?? 'warn')

  return (
    <section className="af-pf-gameday" data-tone={tone} data-kind={bye && !game ? bye.kind : 'game'} data-inactive={inactive && game ? 'true' : undefined} aria-label={m.bannerGameDay}>
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
            {game.preseason ? m.bannerPreseason : ''}
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
                  {m.bannerOpenExternal(l.link, copy(l.link.screen))}
                  <small>{l.leagueName}</small>
                  {/* On a phone: whether this tap lands in the platform's app — measured per platform and screen (nativeApp.ts). */}
                  <AppLinkHint platform={l.platform} screen={l.link.screen} />
                </a>
              ) : (
                <Link key={l.leagueId} className="af-btn af-pf-gameday-btn" href={l.link.href} data-screen={l.link.screen}>
                  {m.openIn(l.link)}
                  <small>{l.leagueName}</small>
                </Link>
              )
            ) : (
              <Link key={l.leagueId} className="af-btn af-btn--ghost af-pf-gameday-btn" href={`/core?league=${encodeURIComponent(l.leagueId)}`}>
                {m.bannerOpen} {l.leagueName}
                <small>
                  {platformLabel(l.platform)} · {m.bannerNoLineupLink}
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
