import Link from 'next/link'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerShares } from '@/lib/core-app/playerShares'
import type { LeagueHolder, LeagueShareView } from '@/lib/core-app/playerSharesLeague'
import { shareOf } from '@/lib/core-app/playerSharesRank'
import { playerRef } from '@/lib/core-app/playerRef'
import { TeamSplit } from '@/components/core-app/player-finder/TeamSplit'
import { TopicTip } from '@/components/core-app/TopicTip'

/**
 * "YOUR SHARES" — the Player Finder home's board of the players you roster most (Phase 2).
 *
 * All leagues: most-held first, with a share bar ("in 9 of 49"), where he starts, and whether he is
 * hurt — the dynastyplanet view with injuries on it. A row opens his card.
 *
 * League mode (?league=X): the same players, and for each: who has him in THIS league, what this
 * league's format makes him worth (AF Pro), and his season points under this league's scoring.
 */

function holderLabel(h: LeagueHolder): { text: string; tone: 'you' | 'other' | 'free' | 'unknown' } {
  switch (h.kind) {
    case 'you':
      return { text: h.slot === 'STARTER' ? 'You · starting' : h.slot === 'IR' ? 'You · IR' : h.slot === 'TAXI' ? 'You · taxi' : 'You · bench', tone: 'you' }
    case 'other':
      return { text: h.ownerName ? `@${h.ownerName}` : h.teamName ?? 'Another manager', tone: 'other' }
    case 'free':
      return { text: 'Free agent', tone: 'free' }
    default:
      return { text: 'Not readable', tone: 'unknown' }
  }
}

export function PlayerSharesBoard({
  state,
  league,
  valuesLocked = false,
}: {
  state: SectionState<PlayerShares>
  /** League mode: this league's view of the same players. */
  league?: LeagueShareView | null
  /** True for a viewer without AF Pro: the value column says so instead of showing numbers. */
  valuesLocked?: boolean
}) {
  if (!state.available) {
    return (
      <section className="af-card af-pf-shares af-pf-shares--empty" aria-labelledby="af-pf-shares-h">
        <h3 className="af-label" id="af-pf-shares-h">
          Your shares
        </h3>
        <p className="af-pf-unavailable">{state.reason}.</p>
      </section>
    )
  }
  const { rows, leaguesRead, playersHeld, unsupportedLeagues } = state.data
  const leagueParam = league ? `&league=${encodeURIComponent(league.leagueId)}` : ''

  return (
    <section className="af-card af-pf-shares" aria-labelledby="af-pf-shares-h" data-mode={league ? 'league' : 'all'}>
      <header className="af-pf-shares-head">
        {/* Grouped so the head's space-between keeps the "?" beside the h3 (not in it: aria-labelledby). */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <h3 className="af-label" id="af-pf-shares-h">
            {league ? `Your shares · in ${league.leagueName}` : 'Your shares'}
          </h3>
          <TopicTip topic="playerShares" />
        </div>
        <span className="af-pf-shares-sub af-num">
          {playersHeld} players across {leaguesRead} {leaguesRead === 1 ? 'roster' : 'rosters'}
          {unsupportedLeagues > 0 ? ` · ${unsupportedLeagues} on a platform we can't read yet` : ''}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="af-pf-unavailable">No rostered players found in the leagues read.</p>
      ) : (
        <ol className="af-pf-shares-list">
          {rows.map((r, i) => {
            const cell = league?.cells[r.player.sleeperId] ?? null
            const holder = cell ? holderLabel(cell.holder) : null
            const href = `/core/players?q=${encodeURIComponent(r.player.name)}&player=${encodeURIComponent(playerRef(r.player.sport, r.player.externalId))}${leagueParam}`
            const pct = Math.round(shareOf(r.leagues, leaguesRead) * 100)
            return (
              <li key={r.player.sleeperId} className="af-pf-share" data-tone={r.status?.tone ?? 'none'}>
                <Link href={href} className="af-pf-share-link">
                  <span className="af-pf-share-rank af-num" aria-hidden>
                    {i + 1}
                  </span>
                  <PlayerAvatar src={r.player.imageUrl} name={r.player.name} size={36} />
                  <span className="af-pf-share-who">
                    <span className="af-pf-share-name">
                      {r.player.name}
                      {r.status ? (
                        <span className="af-chip af-num af-pf-ready af-pf-share-status" data-tone={r.status.tone}>
                          {r.status.label}
                        </span>
                      ) : null}
                    </span>
                    <span className="af-pf-share-meta">
                      {r.player.position ?? ''}
                      {r.player.team ? (
                        <>
                          {r.player.position ? ' · ' : ''}
                          <TeamLogo sport={r.player.sport} team={r.player.team} size={14} />
                          {r.player.team}
                        </>
                      ) : null}
                    </span>
                  </span>

                  <span className="af-pf-share-count">
                    <span className="af-num af-pf-share-of">
                      <strong>{r.leagues}</strong> of {leaguesRead}
                    </span>
                    <span className="af-pf-share-bar" aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <span className="af-pf-share-starts af-num">
                      {r.starts} starting{r.ir > 0 ? ` · ${r.ir} IR` : ''}
                    </span>
                  </span>

                  {league ? (
                    <span className="af-pf-share-league">
                      <span className="af-pf-share-holder" data-holder={holder?.tone}>
                        {holder?.text ?? '—'}
                      </span>
                      <span className="af-pf-share-league-nums af-num">
                        {valuesLocked ? (
                          <span className="af-pf-share-locked">value · AF Pro</span>
                        ) : cell?.value ? (
                          <span title={cell.value.fitNote ?? undefined}>
                            value {cell.value.value.toLocaleString('en-US')}
                            {cell.value.value !== cell.value.base ? '*' : ''}
                          </span>
                        ) : (
                          <span>value —</span>
                        )}
                        <span>
                          {cell?.season
                            ? `${cell.season.points.toFixed(1)} pts · ${cell.season.games} ${cell.season.games === 1 ? 'game' : 'games'}`
                            : league.scoringKnown
                              ? 'no stats yet'
                              : 'scoring unknown'}
                        </span>
                      </span>
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ol>
      )}
      {/* All leagues only: the split is across every roster, which a one-league view would misstate. */}
      {!league ? <TeamSplit data={state.data.teamSplit} /> : null}
      <p className="af-pf-shares-foot">
        {league
          ? `Ranked by how many of your rosters hold him. "Value" is ${league.leagueName}'s format and scoring (* when its scoring moves the market number); points are this season under ${league.leagueName}'s own scoring, from his game stat lines.`
          : 'Ranked by how many of your rosters hold him. Pick a league at the top to see who has each of them there, what they are worth in it, and what they have scored under its scoring.'}
      </p>
    </section>
  )
}

export default PlayerSharesBoard
