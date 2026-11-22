'use client'

import { Fragment } from 'react'
import type { PlayoffRace } from '@/lib/league-media/redraftLeagueHome'
import '@/components/league/native/redraft-home.css'

/**
 * Playoff race: the standings preview with the playoff line where the league's own settings put it
 * (`buildPlayoffRace`). No clinched / eliminated tags — League home does not load the remaining
 * schedule, and without it neither can be proven (see lib/league-media/redraftLeagueHome.ts).
 */
export function RedraftPlayoffRace({ race, onOpenStandings }: { race: PlayoffRace; onOpenStandings: () => void }) {
  return (
    <section className="rdh-card rdh-race" aria-label="Playoff race" data-testid="redraft-playoff-race">
      <div className="rdh-card-head">
        <h2 className="rdh-label">Playoff race</h2>
        <span className="rdh-card-note">Top {race.field} make it</span>
      </div>
      <ol className="rdh-race-list">
        {race.rows.map((row, index) => (
          <Fragment key={row.id}>
            {index > 0 && race.rows[index - 1]!.rank + 1 !== row.rank ? <li className="rdh-race-gap" aria-hidden>…</li> : null}
            <li className="rdh-race-row" data-own-team={row.isYou} data-in-field={row.inField} data-testid={row.isYou ? 'redraft-playoff-race-you' : undefined}>
              <span className="rdh-race-rank">{row.rank}</span>
              <strong className="rdh-race-team">{row.teamName}</strong>
              <span className="rdh-race-record">{row.record}</span>
              {row.isYou ? <span className="rdh-tag rdh-tag-you">You</span> : null}
            </li>
            {race.lineAfter === row.rank ? (
              <li className="rdh-race-line" data-testid="redraft-playoff-line">
                <span aria-hidden />
                <em>Playoff line</em>
                <span aria-hidden />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>
      <button type="button" className="nl-text-link" onClick={onOpenStandings}>Full standings</button>
    </section>
  )
}
