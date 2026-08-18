import { Dash34Time } from '@/components/core-app/screens/Dashboard34Live'
import type { Next24Row } from '@/lib/core-app/todayStrip'

/**
 * The next 24 hours, across every league.
 *
 * ⚠ THIS SUPERSEDES "Needs your call", IT DOES NOT SIT BESIDE IT. That section
 * rendered `dash34.next24`, which is game kickoffs only. This list is a strict
 * superset — the same kickoffs plus real waiver runs — so shipping both would
 * print every kickoff twice under two headings that make the same claim. The
 * NeedsYourCall component is left in place rather than deleted; it is one line
 * to put back if this turns out to be the wrong call.
 *
 * ⚠ TIMES GO THROUGH Dash34Time, NEVER toLocaleTimeString ON THE SERVER. `time`
 * is an ISO instant; the reader's zone is not knowable server-side, so
 * formatting during the first pass is a hydration mismatch. Dash34Time paints
 * "HH:MM UTC" on the server and swaps in the local rendering after hydration.
 *
 * ⚠ AND THE UTC-VS-LOCAL RULE HERE IS NARROWER THAN IT LOOKS. lib/core-app/waivers.ts
 * refuses to localise a waiver time, because doing so there meant reading
 * `League.timezone` — a column that is `@default("America/New_York")` on every
 * production league, so the conversion would apply a zone nobody chose. That
 * objection does not apply to this list: the loader turns the stored weekday and
 * UTC hour into a genuine instant, and Dash34Time converts it to the *reader's
 * own* zone. Converting a real instant for the person looking at it is right;
 * converting it through a fake league zone is what was banned.
 */
export function Next24({ rows }: { rows: Next24Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          Nothing dated in the next day. Waiver runs and kickoffs in the sports
          you play appear here as they approach.
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-card">
      <ul className="af-d2-calls">
        {rows.map((row, i) => (
          <li className="af-d2-call" key={`${row.time}-${row.kind}-${i}`}>
            <span
              className={`af-d2-call-dot${
                row.tone === 'warn' ? ' is-warn' : row.tone === 'accent' ? ' is-accent' : ''
              }`}
              aria-hidden
            />
            <span className="af-d2-call-text">
              {row.text}
              {/*
                The league name for a waiver run, the sport and week for a game.
                A bare "Waivers process" across a 60-league account is a row that
                tells you something is happening without telling you where.
              */}
              {row.sub ? <span className="af-d2-call-sub">{row.sub}</span> : null}
            </span>
            <span className="af-d2-call-time af-num">
              <Dash34Time iso={row.time} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Next24
