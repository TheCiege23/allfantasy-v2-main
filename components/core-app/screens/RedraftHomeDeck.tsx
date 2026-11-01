import Link from 'next/link'
import { RedraftSeasonTrack } from '@/components/league/native/RedraftSeasonTrack'
import type { RedraftDeckSide, RedraftHomeDeck as Deck } from '@/lib/core-app/redraftLeagueHome'
import '@/components/core-app/af-league-home-redraft.css'

/**
 * The redraft "season race" deck at the top of /core's league Home (batch B-ID). Rendered only when
 * the loader built one (`LeagueHomeData.redraft`, lib/core-app/redraftLeagueHome.ts) — an imported
 * league whose stored data positively says redraft. Every block is optional and simply absent when
 * its data is; the builder decides that, this file only draws.
 *
 * Colours are the foundation's `--rd-*` tokens, which exist only under the shell's
 * `data-format="redraft"` stamp (components/league/native/redraft-identity.css). No hex here.
 */

const pts = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·'
}

function Side({ side, align }: { side: RedraftDeckSide; align: 'start' | 'end' }) {
  const value = side.points ?? side.projected
  return (
    <div className="af-lh-rd-side" data-align={align} data-you={side.isYou || undefined}>
      <span className="af-lh-rd-avatar" aria-hidden>
        {side.avatarUrl ? <img src={side.avatarUrl} alt="" /> : initials(side.name)}
      </span>
      <span className="af-lh-rd-side-text">
        <strong className="af-lh-rd-team">{side.name}</strong>
        <span className="af-lh-rd-rec">
          {side.isYou ? 'You' : null}
          {side.isYou && side.record ? ' · ' : null}
          {side.record}
        </span>
      </span>
      <span className="af-lh-rd-score" data-projected={side.points == null || undefined}>
        {value == null ? '—' : pts(value)}
      </span>
    </div>
  )
}

export function RedraftHomeDeck({ deck, leagueId, season }: { deck: Deck; leagueId: string; season: number | null }) {
  const q = `?league=${encodeURIComponent(leagueId)}`
  const bug = deck.scoreBug
  const race = deck.playoffRace
  const recap = deck.recap
  const bugLabel = bug
    ? bug.state === 'final'
      ? `Week ${bug.week} · Final`
      : bug.state === 'scored'
        ? `Week ${bug.week} · Scored so far`
        : `Week ${bug.week} · Up next`
    : null
  return (
    <section className="af-lh-rd" aria-label="Season race" data-testid="redraft-home-deck" data-sport={deck.sport}>
      <div className="af-lh-rd-hero">
        <div className="af-lh-rd-chips">
          <span className="af-lh-rd-chip">Redraft{season ? ` · ${season}` : ''}</span>
          <span className="af-lh-rd-chip af-lh-rd-chip--sport">{deck.sportLabel}</span>
          {deck.regularSeason ? (
            <span className="af-lh-rd-reg">
              Regular season · week <b>{deck.regularSeason.week}</b> of {deck.regularSeason.of}
            </span>
          ) : null}
        </div>
        <RedraftSeasonTrack facts={deck.track} phase={deck.phaseLabel} />
      </div>

      {bug || race || recap ? (
        <div className="af-lh-rd-grid" data-has-race={race ? 'true' : undefined}>
          {bug ? (
            <Link href={`/core/matchup${q}`} className="af-lh-rd-bug" data-state={bug.state} data-testid="redraft-score-bug">
              <span className="af-lh-rd-bug-head">
                <span className="af-lh-rd-eyebrow">{bugLabel}</span>
                {bug.state === 'upcoming' ? <span className="af-lh-rd-pill">Projected</span> : null}
              </span>
              <span className="af-lh-rd-bug-body">
                <Side side={bug.you} align="start" />
                <span className="af-lh-rd-odds">
                  {bug.winPct != null && bug.state !== 'final' ? (
                    <>
                      <span className="af-lh-rd-odds-label">Win odds</span>
                      <strong>{bug.winPct}%</strong>
                    </>
                  ) : (
                    <span className="af-lh-rd-odds-label">vs</span>
                  )}
                </span>
                <Side side={bug.opponent} align="end" />
              </span>
              <span className="af-lh-rd-bug-foot">Open matchup →</span>
            </Link>
          ) : null}

          {race ? (
            <section className="af-lh-rd-race" aria-labelledby="af-lh-rd-race-title" data-testid="redraft-playoff-race">
              <header className="af-lh-rd-card-head">
                <h2 id="af-lh-rd-race-title">Playoff race</h2>
                <span className="af-lh-rd-eyebrow">Top {race.spots} make it</span>
              </header>
              <ol className="af-lh-rd-race-list">
                {race.rows.map((row, i) => (
                  <li key={`${row.rank}-${row.teamName}`} data-in={row.inLine || undefined} data-you={row.isYou || undefined}>
                    {i === race.spots ? (
                      <span className="af-lh-rd-line" role="separator" aria-label="Playoff line">
                        Playoff line
                      </span>
                    ) : null}
                    <span className="af-lh-rd-race-row">
                      <span className="af-lh-rd-rank">{row.rank}</span>
                      <span className="af-lh-rd-race-team">{row.teamName}</span>
                      {row.isYou ? <span className="af-lh-rd-you">You</span> : null}
                      <span className="af-lh-rd-race-rec">{row.record}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <Link className="af-lh-rd-more" href={`/core/standings${q}`}>
                Full standings →
              </Link>
            </section>
          ) : null}

          {recap ? (
            <section className="af-lh-rd-recap" aria-labelledby="af-lh-rd-recap-title" data-testid="redraft-recap">
              <header className="af-lh-rd-card-head">
                <h2 id="af-lh-rd-recap-title">Last week&rsquo;s recap</h2>
                <span className="af-lh-rd-eyebrow">Week {recap.week} · final</span>
              </header>
              <dl className="af-lh-rd-recap-grid">
                <div>
                  <dt>Top score</dt>
                  <dd>
                    <strong>{pts(recap.topScore.points)}</strong>
                    <span>{recap.topScore.team}</span>
                  </dd>
                </div>
                {recap.closest ? (
                  <div>
                    <dt>Closest game</dt>
                    <dd>
                      <strong>by {pts(recap.closest.margin)}</strong>
                      <span>
                        {recap.closest.winner} over {recap.closest.loser}
                      </span>
                    </dd>
                  </div>
                ) : null}
                {recap.biggestWin ? (
                  <div>
                    <dt>Biggest win</dt>
                    <dd>
                      <strong>by {pts(recap.biggestWin.margin)}</strong>
                      <span>
                        {recap.biggestWin.winner} over {recap.biggestWin.loser}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
