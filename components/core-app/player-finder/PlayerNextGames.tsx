'use client'

import type { SectionState } from '@/lib/core-app/leagueHome'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import type { PlayerCardWeek } from '@/lib/core-app/playerCard'
import type { PlayerNextGame } from '@/lib/core-app/playerDepth'
import { SETTLED_GAMES, type MatchupOutlook, type MatchupRead } from '@/lib/core-app/matchupOutlook'
import { playerFinderMessages } from '@/lib/core-app/messages/playerFinder'
import { messagesFor } from '@/lib/i18n/messages'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'

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
 * Spanish (2026-10-04): every string comes from the catalog (lib/core-app/messages/playerFinder.ts) in the reader's language; the kickoff clock goes
 * through `kickoffText`. `marketLine` and `tileLabel` keep their English output byte-identical when
 * called without a language.
 */

export function marketLine(m: PlayerNextGame['market'], language: string = 'en'): string | null {
  if (!m) return null
  const t = messagesFor(playerFinderMessages, language)
  const parts: string[] = []
  if (m.impliedTeamTotal != null) parts.push(t.marketImplied(m.impliedTeamTotal))
  if (m.spread != null)
    parts.push(m.spread < 0 ? t.marketFavored(Math.abs(m.spread)) : m.spread > 0 ? t.marketUnderdog(m.spread) : t.marketPickEm)
  if (m.winProbability != null) parts.push(t.marketWin(Math.round(m.winProbability * 100)))
  if (m.gameTotal != null) parts.push(t.marketGameTotal(m.gameTotal))
  if (parts.length === 0) return null
  return parts.join(' · ') + (m.isStale ? t.marketStale : '')
}

/** The tile: each end counts from its own side, so #1 is always the extreme — "Tough #1" is the stingiest. */
export function tileLabel(r: MatchupRead, language: string = 'en'): string {
  const t = messagesFor(playerFinderMessages, language)
  if (r.tier === 'soft') return `${t.tileSoft} #${r.rank}`
  if (r.tier === 'tough') return `${t.tileTough} #${r.of - r.rank + 1}`
  return t.tileMid
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
  const m = useMessages(playerFinderMessages)
  const line = next.available ? marketLine(next.data.market, language) : null
  return (
    <section className="af-pf-block af-pf-next" aria-labelledby="af-pf-next-h">
      {/* The "?" sits beside the h3, not in it: the h3 names the section (aria-labelledby). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <h3 className="af-label" id="af-pf-next-h">
          {m.nextTitle}
        </h3>
        <TopicTip topic="nextGameMarket" />
      </div>
      {next.available ? (
        <p className="af-pf-next-game">
          <strong>
            {next.data.home ? 'vs' : '@'} {next.data.opponent ?? m.nextTbd}
          </strong>
          {next.data.kickoff ? <span className="af-num"> · {kickoffText(kickoffClock(next.data.kickoff), language)}</span> : null}
          {line ? <span className="af-pf-next-market"> · {line}</span> : null}
        </p>
      ) : (
        <p className="af-pf-unavailable">{coreUiCopy(next.reason, language)}</p>
      )}
      {upcoming.available ? (
        <ol className="af-pf-next-weeks" aria-label={m.nextUpcomingWeeks}>
          {upcoming.data.weeks.map((w) => (
            <li key={w.week} className="af-pf-next-week" data-bye={w.bye ? 'true' : undefined}>
              <span className="af-label">
                {m.nextWk} {w.week}
              </span>
              <span className="af-num">{w.bye ? m.nextBye : `${w.home ? 'vs' : '@'} ${w.opponent ?? '—'}`}</span>
              {matchups?.reads[w.week] ? (
                <span
                  className={`af-pf-next-mu is-${matchups.reads[w.week].tier}`}
                  title={m.nextMuTitle(matchups.reads[w.week], matchups.position, matchups.leagueAverage)}
                >
                  <span aria-hidden="true">
                    {tileLabel(matchups.reads[w.week], language)}
                  </span>
                  <span className="af-pf-next-mu-sr">
                    {m.nextMuSr(matchups.reads[w.week], matchups.position)}
                  </span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {upcoming.available && matchups && Object.keys(matchups.reads).length > 0 ? (
        <p className="af-pf-next-mu-foot">
          {m.nextMuFoot(matchups.position, Object.values(matchups.reads)[0].of)}
          {matchups.minGames < SETTLED_GAMES ? m.nextMuEarly(matchups.minGames) : ''}
        </p>
      ) : null}
    </section>
  )
}

export default PlayerNextGames
