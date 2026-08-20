import { Dash34Time } from '@/components/core-app/screens/Dashboard34Live'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Needs your call — dated items inside the next day, across every league.
 *
 * Fed by dash34's `next24`, which is already cross-league.
 *
 * ⚠ TIMES GO THROUGH Dash34Time, NOT toLocaleTimeString ON THE SERVER. `time` is
 * an ISO string; the server's clock and the reader's are never the same
 * millisecond and the reader's time zone is not knowable server-side, so
 * formatting during the first pass is a hydration mismatch. Dash34Time paints the
 * server's string first and corrects after hydration. It is reused rather than
 * reimplemented so the two dashboards cannot format the same instant differently.
 *
 * ⚠ NO "ASK CHIMMY" BUTTON PER ROW. The handoff puts one on every row. Chimmy
 * costs tokens, and a row-level button implies a per-row answer is ready when
 * nothing has been computed — the launcher is one click away and starts nothing
 * until asked. Adding four buttons that each open the same empty thread is
 * theatre, and on a paid meter it is theatre that bills.
 */
export function NeedsYourCall({ data }: { data: Dash34Data | null }) {
  const rows = data?.next24 ?? null

  if (!rows || rows.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          Nothing dated in the next day. Waiver runs, trade votes and draft
          deadlines appear here as they approach.
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-card">
      <ul className="af-d2-calls">
        {rows.map((row, i) => (
          <li className="af-d2-call" key={`${row.time}-${i}`}>
            <span
              className={`af-d2-call-dot${
                row.tone === 'warn' ? ' is-warn' : row.tone === 'accent' ? ' is-accent' : ''
              }`}
              aria-hidden
            />
            <span className="af-d2-call-text">{row.text}</span>
            <span className="af-d2-call-time af-num">
              <Dash34Time iso={row.time} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default NeedsYourCall
