import type { SectionState } from '@/lib/core-app/leagueHome'
import { kickoffClock } from '@/lib/core-app/lineupLock'
import type { PlayerCardWeek } from '@/lib/core-app/playerCard'
import type { PlayerNextGame } from '@/lib/core-app/playerDepth'

/**
 * "Next game" — the opponent and kickoff, and the betting market's read of HIS offense this week
 * (implied team total, spread, win probability), then the next five weeks with any bye called out.
 *
 * ⚠ THE MARKET LINE IS ABOUT HIS TEAM, NOT HIM. An implied total is how many points the market
 * expects his club to score; the copy says "his team", never "he". A stale quote says so.
 */

export function marketLine(m: PlayerNextGame['market']): string | null {
  if (!m) return null
  const parts: string[] = []
  if (m.impliedTeamTotal != null) parts.push(`his team implied for ${m.impliedTeamTotal.toFixed(1)} pts`)
  if (m.spread != null) parts.push(m.spread < 0 ? `favored by ${Math.abs(m.spread)}` : m.spread > 0 ? `underdog by ${m.spread}` : 'a pick’em')
  if (m.winProbability != null) parts.push(`${Math.round(m.winProbability * 100)}% to win`)
  if (m.gameTotal != null) parts.push(`game total ${m.gameTotal}`)
  if (parts.length === 0) return null
  return parts.join(' · ') + (m.isStale ? ' · line may be out of date' : '')
}

export function PlayerNextGames({
  next,
  upcoming,
}: {
  next: SectionState<PlayerNextGame>
  upcoming: SectionState<{ weeks: PlayerCardWeek[]; season: number }>
}) {
  const line = next.available ? marketLine(next.data.market) : null
  return (
    <section className="af-pf-block af-pf-next" aria-labelledby="af-pf-next-h">
      <h3 className="af-label" id="af-pf-next-h">
        Next game
      </h3>
      {next.available ? (
        <p className="af-pf-next-game">
          <strong>
            {next.data.home ? 'vs' : '@'} {next.data.opponent ?? 'TBD'}
          </strong>
          {next.data.kickoff ? <span className="af-num"> · {kickoffClock(next.data.kickoff)}</span> : null}
          {line ? <span className="af-pf-next-market"> · {line}</span> : null}
        </p>
      ) : (
        <p className="af-pf-unavailable">{next.reason}</p>
      )}
      {upcoming.available ? (
        <ol className="af-pf-next-weeks" aria-label="Upcoming weeks">
          {upcoming.data.weeks.map((w) => (
            <li key={w.week} className="af-pf-next-week" data-bye={w.bye ? 'true' : undefined}>
              <span className="af-label">Wk {w.week}</span>
              <span className="af-num">{w.bye ? 'BYE' : `${w.home ? 'vs' : '@'} ${w.opponent ?? '—'}`}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

export default PlayerNextGames
