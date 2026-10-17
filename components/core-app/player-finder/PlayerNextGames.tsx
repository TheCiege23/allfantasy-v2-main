'use client'

import type { SectionState } from '@/lib/core-app/leagueHome'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import type { PlayerCardWeek } from '@/lib/core-app/playerCard'
import type { PlayerNextGame } from '@/lib/core-app/playerDepth'
import { SETTLED_GAMES, rankPhrase, type MatchupOutlook, type MatchupRead } from '@/lib/core-app/matchupOutlook'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Next game" — the opponent and kickoff, and the betting market's read of HIS offense this week
 * (implied team total, spread, win probability), then the next five weeks with any bye called out.
 *
 * ⚠ THE MARKET LINE IS ABOUT HIS TEAM, NOT HIM. An implied total is how many points the market
 * expects his club to score; the copy says "his team", never "he". A stale quote says so.
 *
 * Each upcoming week can carry a matchup rank (matchupOutlook.ts): where that defense ranks for
 * points allowed to his position this season, with the sample it rests on in the footnote.
 *
 * Spanish (2026-10-04): every string is built here in the reader's language; the kickoff clock goes
 * through `kickoffText`. `marketLine` and `tileLabel` keep their English output byte-identical when
 * called without a language.
 */

export function marketLine(m: PlayerNextGame['market'], language: string = 'en'): string | null {
  if (!m) return null
  const es = language === 'es'
  const parts: string[] = []
  if (m.impliedTeamTotal != null)
    parts.push(es ? `su equipo con ${m.impliedTeamTotal.toFixed(1)} pts implícitos` : `his team implied for ${m.impliedTeamTotal.toFixed(1)} pts`)
  if (m.spread != null)
    parts.push(
      es
        ? m.spread < 0
          ? `favorito por ${Math.abs(m.spread)}`
          : m.spread > 0
            ? `no favorito por ${m.spread}`
            : 'parejo'
        : m.spread < 0
          ? `favored by ${Math.abs(m.spread)}`
          : m.spread > 0
            ? `underdog by ${m.spread}`
            : 'a pick’em',
    )
  if (m.winProbability != null) parts.push(es ? `${Math.round(m.winProbability * 100)}% de ganar` : `${Math.round(m.winProbability * 100)}% to win`)
  if (m.gameTotal != null) parts.push(es ? `total del partido ${m.gameTotal}` : `game total ${m.gameTotal}`)
  if (parts.length === 0) return null
  return parts.join(' · ') + (m.isStale ? (es ? ' · la línea puede estar desactualizada' : ' · line may be out of date') : '')
}

/** The tile: each end counts from its own side, so #1 is always the extreme — "Tough #1" is the stingiest. */
export function tileLabel(r: MatchupRead, language: string = 'en'): string {
  const es = language === 'es'
  if (r.tier === 'soft') return `${es ? 'Fácil' : 'Soft'} #${r.rank}`
  if (r.tier === 'tough') return `${es ? 'Difícil' : 'Tough'} #${r.of - r.rank + 1}`
  return es ? 'Media' : 'Mid'
}

/** `rankPhrase` (matchupOutlook.ts) in Spanish — the screen-reader text beside the tile. */
function rankPhraseEs(r: MatchupRead, position: string): string {
  const nth = (n: number, word: string) => (n === 1 ? `la defensa más ${word}` : `${n}.ª defensa más ${word}`)
  if (r.tier === 'soft') return `${nth(r.rank, 'fácil')} contra ${position}`
  if (r.tier === 'tough') return `${nth(r.of - r.rank + 1, 'difícil')} contra ${position}`
  return `en la media contra ${position}`
}

export function PlayerNextGames({
  next,
  upcoming,
  matchups = null,
}: {
  next: SectionState<PlayerNextGame>
  upcoming: SectionState<{ weeks: PlayerCardWeek[]; season: number }>
  matchups?: MatchupOutlook | null
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const line = next.available ? marketLine(next.data.market, language) : null
  return (
    <section className="af-pf-block af-pf-next" aria-labelledby="af-pf-next-h">
      {/* The "?" sits beside the h3, not in it: the h3 names the section (aria-labelledby). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <h3 className="af-label" id="af-pf-next-h">
          {es ? 'Próximo partido' : 'Next game'}
        </h3>
        <TopicTip topic="nextGameMarket" />
      </div>
      {next.available ? (
        <p className="af-pf-next-game">
          <strong>
            {next.data.home ? 'vs' : '@'} {next.data.opponent ?? (es ? 'Por definir' : 'TBD')}
          </strong>
          {next.data.kickoff ? <span className="af-num"> · {kickoffText(kickoffClock(next.data.kickoff), language)}</span> : null}
          {line ? <span className="af-pf-next-market"> · {line}</span> : null}
        </p>
      ) : (
        <p className="af-pf-unavailable">{coreUiCopy(next.reason, language)}</p>
      )}
      {upcoming.available ? (
        <ol className="af-pf-next-weeks" aria-label={es ? 'Próximas semanas' : 'Upcoming weeks'}>
          {upcoming.data.weeks.map((w) => (
            <li key={w.week} className="af-pf-next-week" data-bye={w.bye ? 'true' : undefined}>
              <span className="af-label">
                {es ? 'Sem.' : 'Wk'} {w.week}
              </span>
              <span className="af-num">{w.bye ? (es ? 'DESCANSO' : 'BYE') : `${w.home ? 'vs' : '@'} ${w.opponent ?? '—'}`}</span>
              {matchups?.reads[w.week] ? (
                <span
                  className={`af-pf-next-mu is-${matchups.reads[w.week].tier}`}
                  title={
                    es
                      ? `${matchups.reads[w.week].opponent} permite ${matchups.reads[w.week].allowedPerGame.toFixed(1)} PPR por partido a los ${matchups.position} en ${matchups.reads[w.week].games} partidos (promedio de la liga ${matchups.leagueAverage.toFixed(1)})`
                      : `${matchups.reads[w.week].opponent} allows ${matchups.reads[w.week].allowedPerGame.toFixed(1)} PPR a game to ${matchups.position}s over ${matchups.reads[w.week].games} games (league average ${matchups.leagueAverage.toFixed(1)})`
                  }
                >
                  <span aria-hidden="true">
                    {tileLabel(matchups.reads[w.week], language)}
                  </span>
                  <span className="af-pf-next-mu-sr">
                    {es ? rankPhraseEs(matchups.reads[w.week], matchups.position) : rankPhrase(matchups.reads[w.week], matchups.position)}
                  </span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {upcoming.available && matchups && Object.keys(matchups.reads).length > 0 ? (
        es ? (
          <p className="af-pf-next-mu-foot">
            Rango del enfrentamiento: puntos PPR por partido que cada defensa ha permitido a los {matchups.position} esta temporada, entre{' '}
            {Object.values(matchups.reads)[0].of} defensas. Fácil #1 permite más, Difícil #1 permite menos.
            {matchups.minGames < SETTLED_GAMES
              ? ` Una lectura temprana: algunas defensas solo han jugado ${matchups.minGames} ${matchups.minGames === 1 ? 'partido' : 'partidos'}.`
              : ''}
          </p>
        ) : (
          <p className="af-pf-next-mu-foot">
            Matchup ranks: PPR points each defense has allowed to {matchups.position}s per game this season, among{' '}
            {Object.values(matchups.reads)[0].of} defenses — Soft #1 allows the most, Tough #1 the least.
            {matchups.minGames < SETTLED_GAMES ? ` An early read — some defenses have played only ${matchups.minGames} ${matchups.minGames === 1 ? 'game' : 'games'}.` : ''}
          </p>
        )
      ) : null}
    </section>
  )
}

export default PlayerNextGames
