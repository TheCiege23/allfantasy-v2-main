'use client'

import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

/**
 * Every game in the league this week.
 *
 * ⚠ THE PANEL SHOWED ONE MATCHUP — THE VIEWER'S — on a screen whose whole
 * subject is the league. The other five games were invisible, so you could not
 * see who was getting blown out, who was in a shootout, or whether next week's
 * opponent was in trouble.
 *
 * ⚠ AND WHEN THE WEEK IS UNPLAYED, EVERY NUMBER HERE IS A PROJECTION. It has to
 * say so, loudly and once at the top rather than in a footnote per row. A
 * projected scoreboard that reads like a live one is worse than no scoreboard:
 * it invites someone to celebrate or panic over a game nobody has played.
 */

function Side({ team, unplayed }: { team: ScoreboardTeam; unplayed: boolean }) {
  const value = team.points ?? team.projected
  const partial = unplayed && team.projected != null && team.projectedFrom < team.starterCount

  return (
    <div className="af-sb-side" data-you={team.isYou}>
      {team.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="af-sb-av" src={team.avatarUrl} alt="" width={24} height={24} />
      ) : (
        <span className="af-sb-av af-sb-av--none" aria-hidden>
          {(team.teamName ?? team.managerName ?? '?').charAt(0)}
        </span>
      )}
      <span className="af-sb-name">
        {team.teamName ?? team.managerName ?? `Roster ${team.rosterId}`}
      </span>
      <span className="af-sb-pts af-num" data-projected={unplayed}>
        {value != null ? value.toFixed(1) : '—'}
      </span>
      {/*
        Coverage travels with the number it qualifies. A total built from five
        of nine starters reads low, and next to a complete one it looks like a
        gap between teams rather than a gap in our data.
      */}
      {partial ? (
        <span className="af-sb-cov" title="Projected from only part of this lineup">
          {team.projectedFrom}/{team.starterCount}
        </span>
      ) : null}
    </div>
  )
}

export function LeagueScoreboardPanel({
  board,
  winProbability,
}: {
  board: LeagueScoreboard
  /**
   * The engine's read on YOUR game, when it produced one.
   *
   * ⚠ IT ARRIVES FROM THE PANEL THAT USED TO SIT BELOW THIS ONE. That panel
   * printed the same matchup a second time and was deleted; this was the only
   * thing on it the scoreboard did not already say, so it moved rather than
   * going with it. Null when both lineups could not be priced — a probability
   * built on a half-priced lineup is a number about our coverage, not about
   * the game.
   */
  winProbability?: { pWin: number; confidence: string } | null
}) {
  return (
    <div className="af-sb">
      <div className="af-sb-head">
        <span className="af-label">
          Week {board.week} · {board.games.length} {board.games.length === 1 ? 'game' : 'games'}
        </span>
        {board.allUnplayed ? (
          <span className="af-sb-proj-flag">
            Nothing scored yet — these are projections, under your league&rsquo;s scoring
          </span>
        ) : null}
      </div>

      <ul className="af-sb-list">
        {board.games.map((g) => (
          <li key={g.matchupId ?? 'x'} className="af-sb-game" data-yours={g.teams.some((t) => t.isYou)}>
            <div className="af-sb-teams">
              {g.teams.map((t) => (
                <Side key={t.rosterId} team={t} unplayed={g.unplayed} />
              ))}
            </div>
            {g.teams.some((t) => t.isYou) && winProbability ? (
              <span
                className="af-sb-winprob af-num"
                title={`Win probability · ${winProbability.confidence}`}
              >
                {Math.round(winProbability.pWin * 100)}%
              </span>
            ) : g.margin != null ? (
              <span className="af-sb-margin af-num">
                {g.margin === 0 ? 'level' : `by ${g.margin.toFixed(1)}`}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {/*
        Teams the league recorded without pairing them into a game. Common
        before a season starts. Dropping them silently would lose half the
        league from a panel that claims to show all of it.
      */}
      {board.unpaired.length > 0 ? (
        <div className="af-sb-unpaired">
          <span className="af-label">Not paired into a game yet</span>
          <span className="af-sb-unpaired-who">
            {board.unpaired
              .map((t) => t.teamName ?? t.managerName ?? `Roster ${t.rosterId}`)
              .join(', ')}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default LeagueScoreboardPanel
