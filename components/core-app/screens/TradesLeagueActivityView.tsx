import { activityText, type ActivityRow } from '@/lib/core-app/tradesActivity'
import { tradesActivityMessages } from '@/lib/core-app/messages/tradesActivity'
import { messagesFor } from '@/lib/i18n/messages'

/**
 * League activity, under the trade history on the Trades tab (2026-11-14). It is what the Moves tab had
 * that Trades did not: the adds, drops and claims across the league. Moves is gone and /core/moves
 * lands here (next.config.js).
 *
 * `rows: null` is a read that failed, which says so rather than reading as an empty league.
 */
export function TradesLeagueActivityView({ rows, language }: { rows: ActivityRow[] | null; language: string }) {
  const t = messagesFor(tradesActivityMessages, language)
  const day = new Intl.DateTimeFormat(t.dateLocale, { month: 'short', day: 'numeric' })
  return (
    <section className="af-tc-activity" id="league-activity" aria-labelledby="af-tc-activity-title" data-testid="trades-league-activity">
      <h2 id="af-tc-activity-title" className="af-tc-activity-title">
        {t.title}
      </h2>
      <p className="af-tc-activity-sub">{t.sub}</p>
      {rows == null ? (
        <p className="af-tc-activity-empty">{t.unavailable}</p>
      ) : rows.length === 0 ? (
        <p className="af-tc-activity-empty">{t.empty}</p>
      ) : (
        <ul className="af-tc-activity-list">
          {rows.map((r) => (
            <li key={r.id} className="af-tc-activity-row" data-testid="trades-league-activity-row">
              <time className="af-tc-activity-when af-num" dateTime={r.at}>
                {day.format(new Date(r.at))}
              </time>
              <span className="af-tc-activity-what">
                <b>{r.team ?? t.aManager}</b> {activityText(r, t)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
