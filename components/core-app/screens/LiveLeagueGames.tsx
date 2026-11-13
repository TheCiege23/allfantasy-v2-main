'use client'

import '@/components/core-app/af-live-league-games.css'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { liveLeagueGamesMessages } from '@/lib/core-app/messages/liveLeagueGames'
import type { LiveLeagueGames as LiveLeagueGamesData } from '@/lib/core-app/liveLeagueScoreboard'
import type { ScoreboardGame, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'
import { rosterLabel } from '@/lib/core-app/managerName'

type LiveGameState = 'live' | 'final' | 'upcoming'

/**
 * A game's chip. ScoreboardGame carries no state of its own: unscored is upcoming (its numbers are
 * projections), scored in a week the platform has closed is final, and scored in an open week is live.
 */
export function liveGameState(game: ScoreboardGame, weekFinal: boolean): LiveGameState {
  if (game.unplayed) return 'upcoming'
  return weekFinal ? 'final' : 'live'
}

/** Points once scored, else the projection — and which one it is, so a projection is never read as a score. */
function shown(team: ScoreboardTeam): { value: number | null; projected: boolean } {
  if (team.points != null) return { value: team.points, projected: false }
  return { value: team.projected, projected: team.projected != null }
}

/**
 * The rest of the held league's games, under your own matchup card on Live scores. Compact rows:
 * both teams, the live score (or projection, marked), and a LIVE / FINAL / UPCOMING chip.
 */
export function LiveLeagueGames({
  leagueId,
  data,
}: {
  leagueId: string
  data: LiveLeagueGamesData & { weekFinal: boolean }
}) {
  const m = useMessages(liveLeagueGamesMessages)
  if (data.games.length === 0) return null
  return (
    <section className="af-llg" aria-label={m.aria} data-testid="live-league-games">
      <header className="af-llg-head">
        <h2 className="af-label af-llg-title">{m.title(data.week)}</h2>
        <Link className="af-llg-more" href={`/core?league=${encodeURIComponent(leagueId)}`} prefetch={false}>
          {m.openMatchups} →
        </Link>
      </header>
      {data.allUnplayed ? <p className="af-llg-note">{m.allProjected}</p> : null}
      <ul className="af-llg-list">
        {data.games.map((game, i) => {
          const state = liveGameState(game, data.weekFinal)
          const [a, b] = game.teams
          const sa = shown(a)
          const sb = shown(b)
          const lead = sa.value != null && sb.value != null && sa.value !== sb.value ? (sa.value > sb.value ? 0 : 1) : null
          return (
            <li className="af-llg-game" key={game.matchupId ?? i} data-state={state} data-testid="live-league-game">
              <div className="af-llg-teams">
                {[a, b].map((team, side) => {
                  const s = side === 0 ? sa : sb
                  return (
                    <div className="af-llg-team" key={team.rosterId} data-lead={lead === side ? 'true' : undefined}>
                      <span className="af-llg-name">{rosterLabel([team.teamName, team.managerName], team.rosterId)}</span>
                      <span className="af-llg-pts af-num">
                        {s.value != null ? s.value.toFixed(1) : '—'}
                        {s.projected ? <small className="af-llg-proj"> {m.proj}</small> : null}
                      </span>
                    </div>
                  )
                })}
              </div>
              <span className="af-llg-chip" data-state={state}>
                {state === 'live' ? m.live : state === 'final' ? m.final : m.upcoming}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
