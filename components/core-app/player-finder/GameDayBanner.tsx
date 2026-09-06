import Link from 'next/link'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import type { PlayerGame } from '@/lib/core-app/playerGame'
import { kickoffClock, lockState } from '@/lib/core-app/lineupLock'
import { reportedLabel } from '@/lib/core-app/injuryReport'
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
  nowIso: string
  /** Leagues where he is in YOUR starting lineup. */
  starting: GameDayLeague[]
  /** Leagues where he is yours but not starting. */
  benched: number
  /** Leagues where someone else has him. */
  elsewhere: number
}) {
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName
  const n = starting.length
  const leagues = (k: number) => `${k} ${k === 1 ? 'league' : 'leagues'}`
  // Once his game has started nothing of his can move on any platform; say so instead of offering buttons.
  const locked = game ? lockState(game.kickoff, nowIso).state === 'locked' : false
  const reported = reportedLabel(reportedAt, nowIso)

  let summary: string
  if (bye && !game) {
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

  const tone = bye && !game ? bye.tone : (status?.tone ?? 'warn')

  return (
    <section className="af-pf-gameday" data-tone={tone} data-kind={bye && !game ? bye.kind : 'game'} aria-label="Game day">
      <div className="af-pf-gameday-top">
        {status ? (
          <span className="af-chip af-num af-pf-ready" data-tone={status.tone}>
            {status.label}
            {detail ? ` · ${detail}` : ''}
          </span>
        ) : null}
        {bye && !game ? (
          <span className="af-chip af-num af-pf-ready af-pf-bye" data-tone={bye.tone}>
            {bye.label}
          </span>
        ) : null}
        {game ? (
          <span className="af-pf-gameday-game af-num">
            {game.home ? 'vs' : '@'} {game.opponent} · {kickoffClock(game.kickoff)}
            {game.preseason ? ' · preseason' : ''}
          </span>
        ) : null}
        {reported ? <span className="af-pf-gameday-when af-num">{reported}</span> : null}
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
                  {l.link.screen === 'Lineup' ? `Open lineup in ${l.link.platformLabel}` : `${l.link.label} · ${l.link.screen}`}
                  <small>{l.leagueName}</small>
                </a>
              ) : (
                <Link key={l.leagueId} className="af-btn af-pf-gameday-btn" href={l.link.href} data-screen={l.link.screen}>
                  {l.link.label}
                  <small>{l.leagueName}</small>
                </Link>
              )
            ) : (
              <Link key={l.leagueId} className="af-btn af-btn--ghost af-pf-gameday-btn" href={`/core?league=${encodeURIComponent(l.leagueId)}`}>
                Open {l.leagueName}
                <small>{platformLabel(l.platform)} · no lineup link on file</small>
              </Link>
            ),
          )}
        </div>
      ) : null}
    </section>
  )
}

export default GameDayBanner
