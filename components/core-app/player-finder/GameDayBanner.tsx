import Link from 'next/link'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import type { PlayerGame } from '@/lib/core-app/playerGame'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { platformLabel, type PlatformLink } from '@/lib/core-app/platformLinks'

/**
 * The game-day header: an at-risk or ruled-out player, his kickoff, the lock
 * counting down, and one Open-lineup button per league where he is in your
 * starting lineup — at the top of the card, where a thumb lands at kickoff
 * minus twenty.
 *
 * AllFantasy cannot write a lineup. The button opens that league's lineup
 * screen on its own platform (verified formats only — an unverified one opens
 * the league page, labelled as such), and the change is made there.
 *
 * Rendered only when the injury feed says Questionable / Doubtful / Out and a
 * kickoff is on the schedule. A healthy player, or one with no game found, has
 * no banner: the rows still carry their lock, the header still carries his
 * status.
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
  game,
  nowIso,
  starting,
  benched,
  elsewhere,
}: {
  playerName: string
  status: { label: string; tone: string }
  /** The injury description, when short enough to sit beside the status. */
  detail: string | null
  game: PlayerGame
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
  const summary =
    n > 0
      ? `Starting in ${n} of your ${n === 1 ? 'league' : 'leagues'} — move ${last} before kickoff.`
      : benched > 0
        ? `On your bench in ${benched} ${benched === 1 ? 'league' : 'leagues'} — nothing to move before kickoff.`
        : elsewhere > 0
          ? `Not on any of your rosters — someone else has him in ${elsewhere} ${elsewhere === 1 ? 'league' : 'leagues'}.`
          : 'Not on any roster we read.'

  return (
    <section className="af-pf-gameday" data-tone={status.tone} aria-label="Game day">
      <div className="af-pf-gameday-top">
        <span className="af-chip af-num af-pf-ready" data-tone={status.tone}>
          {status.label}
          {detail ? ` · ${detail}` : ''}
        </span>
        <span className="af-pf-gameday-game af-num">
          {game.home ? 'vs' : '@'} {game.opponent} · {kickoffClock(game.kickoff)}
          {game.preseason ? ' · preseason' : ''}
        </span>
        <LockClock kickoffIso={game.kickoff} nowIso={nowIso} big />
      </div>
      <p className="af-pf-gameday-sum">{summary}</p>
      {n > 0 ? (
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
