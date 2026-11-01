'use client'

import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { redraftHomeDeckMessages } from '@/lib/core-app/messages/redraftHomeDeck'
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
  const m = useMessages(redraftHomeDeckMessages)
  const value = side.points ?? side.projected
  return (
    <div className="af-lh-rd-side" data-align={align} data-you={side.isYou || undefined}>
      <span className="af-lh-rd-avatar" aria-hidden>
        {side.avatarUrl ? <img src={side.avatarUrl} alt="" /> : initials(side.name)}
      </span>
      <span className="af-lh-rd-side-text">
        <strong className="af-lh-rd-team">{side.name}</strong>
        <span className="af-lh-rd-rec">
          {side.isYou ? m.you : null}
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
  const m = useMessages(redraftHomeDeckMessages)
  const q = `?league=${encodeURIComponent(leagueId)}`
  const bug = deck.scoreBug
  const race = deck.playoffRace
  const recap = deck.recap
  const bugLabel = bug
    ? bug.state === 'final'
      ? m.weekFinal(bug.week)
      : bug.state === 'scored'
        ? m.weekScored(bug.week)
        : m.weekUpNext(bug.week)
    : null
  return (
    <section className="af-lh-rd" aria-label={m.deckLabel} data-testid="redraft-home-deck" data-sport={deck.sport}>
      <div className="af-lh-rd-hero">
        <div className="af-lh-rd-chips">
          <span className="af-lh-rd-chip">{m.redraft}{season ? ` · ${season}` : ''}</span>
          <span className="af-lh-rd-chip af-lh-rd-chip--sport">{deck.sportLabel}</span>
          {deck.regularSeason ? (
            <span className="af-lh-rd-reg">
              {m.regularSeason} <b>{deck.regularSeason.week}</b>
              {m.regularSeasonOf(deck.regularSeason.of)}
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
                {bug.state === 'upcoming' ? <span className="af-lh-rd-pill">{m.projected}</span> : null}
              </span>
              <span className="af-lh-rd-bug-body">
                <Side side={bug.you} align="start" />
                <span className="af-lh-rd-odds">
                  {bug.winPct != null && bug.state !== 'final' ? (
                    <>
                      <span className="af-lh-rd-odds-label">{m.winOdds}</span>
                      <strong>{bug.winPct}%</strong>
                    </>
                  ) : (
                    <span className="af-lh-rd-odds-label">{m.versus}</span>
                  )}
                </span>
                <Side side={bug.opponent} align="end" />
              </span>
              <span className="af-lh-rd-bug-foot">{m.openMatchup}</span>
            </Link>
          ) : null}

          {race ? (
            <section className="af-lh-rd-race" aria-labelledby="af-lh-rd-race-title" data-testid="redraft-playoff-race">
              <header className="af-lh-rd-card-head">
                <h2 id="af-lh-rd-race-title">{m.playoffRace}</h2>
                <span className="af-lh-rd-eyebrow">{m.topMakeIt(race.spots)}</span>
              </header>
              <ol className="af-lh-rd-race-list">
                {race.rows.map((row, i) => (
                  <li key={`${row.rank}-${row.teamName}`} data-in={row.inLine || undefined} data-you={row.isYou || undefined}>
                    {i === race.spots ? (
                      <span className="af-lh-rd-line" role="separator" aria-label={m.playoffLine}>
                        {m.playoffLine}
                      </span>
                    ) : null}
                    <span className="af-lh-rd-race-row">
                      <span className="af-lh-rd-rank">{row.rank}</span>
                      <span className="af-lh-rd-race-team">{row.teamName}</span>
                      {row.isYou ? <span className="af-lh-rd-you">{m.you}</span> : null}
                      <span className="af-lh-rd-race-rec">{row.record}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <Link className="af-lh-rd-more" href={`/core/standings${q}`}>
                {m.fullStandings}
              </Link>
            </section>
          ) : null}

          {recap ? (
            <section className="af-lh-rd-recap" aria-labelledby="af-lh-rd-recap-title" data-testid="redraft-recap">
              <header className="af-lh-rd-card-head">
                <h2 id="af-lh-rd-recap-title">{m.recapTitle}</h2>
                <span className="af-lh-rd-eyebrow">{m.recapWeek(recap.week)}</span>
              </header>
              <dl className="af-lh-rd-recap-grid">
                <div>
                  <dt>{m.topScore}</dt>
                  <dd>
                    <strong>{pts(recap.topScore.points)}</strong>
                    <span>{recap.topScore.team}</span>
                  </dd>
                </div>
                {recap.closest ? (
                  <div>
                    <dt>{m.closestGame}</dt>
                    <dd>
                      <strong>{m.byMargin(pts(recap.closest.margin))}</strong>
                      <span>{m.over(recap.closest.winner, recap.closest.loser)}</span>
                    </dd>
                  </div>
                ) : null}
                {recap.biggestWin ? (
                  <div>
                    <dt>{m.biggestWin}</dt>
                    <dd>
                      <strong>{m.byMargin(pts(recap.biggestWin.margin))}</strong>
                      <span>{m.over(recap.biggestWin.winner, recap.biggestWin.loser)}</span>
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
