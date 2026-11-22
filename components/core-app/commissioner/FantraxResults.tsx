import Link from 'next/link'
import { fantraxMonthResults, type FantraxResultsReport } from '@/lib/league-import/fantrax/fantraxResultsReport'

const easternTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function FantraxResults({ leagueId, report }: { leagueId: string; report: FantraxResultsReport | null }) {
  const league = encodeURIComponent(leagueId)
  const months = report ? fantraxMonthResults(report.periods) : []
  const count = report?.periods.reduce((total, period) => total + period.matchups, 0) ?? 0
  const recent = report?.periods.slice(-4).reverse() ?? []
  return (
    <section className="afh-panel" id="ch-results" aria-labelledby="ch-results-title">
      <div className="afh-panel-head">
        <h2 className="afh-label" id="ch-results-title">Fantrax results</h2>
      </div>
      <nav className="afh-card-actions" aria-label="League result views">
        <Link href={`/core/standings?league=${league}`}>Official standings</Link>
        <Link href={`/core/week?league=${league}`}>Matchup scores</Link>
      </nav>
      {report ? (
        <>
          <p className="afh-row-detail">Last checked {easternTime.format(new Date(report.refreshedAt))} ET</p>
          <p>
            <strong>{report.season} season</strong> · {count.toLocaleString('en-US')} completed matchups
            {report.phase === 'preseason' ? ' · Preseason' : report.phase === 'complete' ? ' · Ended' : ''}
          </p>
          {recent.length ? (
            <details>
              <summary>Recent scoring periods</summary>
              <ul>
                {recent.map((period) => (
                  <li key={period.period}>
                    <Link href={`/core/week?league=${league}&week=${period.period}`}>Period {period.period}</Link>
                    {' · '}{period.endsOn}{' · '}{period.matchups} matchups
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {months.length ? (
            <details>
              <summary>Monthly results</summary>
              <ul>
                {months.map((row) => (
                  <li key={row.month}>
                    <strong>{row.month}</strong> · {row.matchups} matchups · {row.playoffMatchups} playoff matchups
                    {row.scoreTies ? ` · ${row.scoreTies} tied on points` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="afh-row-detail">Scoring-period results appear after AllFantasy refreshes this Fantrax import.</p>
      )}
    </section>
  )
}
