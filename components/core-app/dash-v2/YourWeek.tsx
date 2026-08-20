import type { WeekAllData } from '@/lib/core-app/weekAll'

/**
 * Your week — real scored matchups, from WeeklyMatchup.
 *
 * ⚠ THE SEASON IS ALWAYS LABELLED. Every row on production is season 2025 while
 * the clock reads 2026, so presenting these as "this week" would be the lie. The
 * header states the season and week the numbers come from, and the module reads
 * as history when it is history.
 *
 * ⚠ NO WIN PROBABILITY. The handoff shows a projected % per matchup. These are
 * finished games with a final score — a probability over a settled result is
 * theatre. The real margin is shown instead, which is the thing the % was
 * standing in for.
 */
export function YourWeek({ data }: { data: WeekAllData | null }) {
  if (!data || data.rows.length === 0) {
    return (
      <div className="af-d2-card">
        {/*
          ⚠ TWO DIFFERENT EMPTY STATES, AND THE READER NEEDS TO KNOW WHICH.
          "We have no schedule for your leagues" and "the schedule exists but
          nothing has kicked off yet" look identical on screen and mean opposite
          things — the first is a data gap worth chasing, the second is just a
          Tuesday. Before this, unscored matchups were rendered as played games
          at 0.00 and counted as LOSSES, so the screen said "0-2" for a week
          nobody had played.
        */}
        <p className="af-d2-empty">
          {data && data.unscored > 0
            ? `${data.unscored} ${
                data.unscored === 1 ? 'matchup is' : 'matchups are'
              } scheduled but not played yet${
                data.week != null && data.season != null
                  ? ` (week ${data.week}, ${data.season})`
                  : ''
              }. Scores appear here once games are final.`
            : 'No scored matchups on file for your leagues yet. Weekly results are cached from the platform when a league syncs — once that runs, every league’s week shows here with its real margin.'}
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-card">
      <ul className="af-d2-week">
        {data.rows.map((row) => {
          const margin = row.pointsFor - row.pointsAgainst
          return (
            <li key={`${row.leagueId}-${row.week}`} className="af-d2-week-row">
              <span className={`af-d2-week-mark af-num${row.won ? ' is-win' : ' is-loss'}`}>
                {row.won ? 'W' : 'L'}
              </span>
              <span className="af-d2-week-name">{row.leagueName}</span>
              <span className="af-d2-week-score af-num">
                {row.pointsFor.toFixed(2)} — {row.pointsAgainst.toFixed(2)}
              </span>
              <span
                className={`af-d2-week-margin af-num${margin >= 0 ? ' is-win' : ' is-loss'}`}
              >
                {margin >= 0 ? '+' : ''}
                {margin.toFixed(2)}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="af-d2-week-foot">
        {data.record ? (
          <>
            {data.record.wins}–{data.record.losses} in week {data.week}, {data.season}.{' '}
          </>
        ) : null}
        {/*
          Naming the gap rather than letting a short list imply the account is
          small. Most leagues genuinely have no cached history.
        */}
        {data.withoutHistory > 0
          ? `${data.withoutHistory} of your leagues have no cached weekly results.`
          : null}
      </p>
    </div>
  )
}

export default YourWeek
