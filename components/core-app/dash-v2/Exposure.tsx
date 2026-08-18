import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Player exposure — how much of your account rides on one player.
 *
 * Wired to dash34's `book`, which already computes this: it walks every claimed
 * roster, groups by player, and counts the distinct leagues each appears in. The
 * loader now emits that as numbers (`exposureCount` / `exposureTotal`) alongside
 * the human string, so the share bar is computed rather than parsed back out of
 * "7 of 61" — a display string is not a data source.
 *
 * ⚠ THE BOOK IS INJURY-LED, NOT A FULL EXPOSURE TABLE. dash34 builds it from
 * players carrying a status worth flagging and caps it at six rows, sorted by
 * unavailability first. So this answers "what am I most exposed to that is
 * currently a problem" — which is the useful question — and NOT "here is every
 * player I roster". The footnote says so, because a six-row list under a header
 * that reads "exposure" otherwise implies you only roster six people.
 */
export function Exposure({ data }: { data: Dash34Data | null }) {
  const book = data?.book ?? null

  if (!book || book.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          No flagged players across your rosters right now. This fills in when a
          player you roster in more than one league picks up an injury status.
        </p>
      </div>
    )
  }

  return (
    <div className="af-d2-card">
      <ul className="af-d2-exposure">
        {book.map((row) => {
          const count = row.exposureCount ?? null
          const total = row.exposureTotal ?? null
          const pct =
            count != null && total != null && total > 0
              ? Math.round((count / total) * 100)
              : null

          return (
            <li key={row.name} className="af-d2-exp-row">
              <span className="af-d2-exp-mark af-num" aria-hidden>
                {row.initials}
              </span>

              <span className="af-d2-exp-text">
                <span className="af-d2-exp-name">{row.name}</span>
                <span
                  className={`af-d2-exp-note af-num${
                    row.tone === 'bad' ? ' is-bad' : row.tone === 'warn' ? ' is-warn' : ''
                  }`}
                >
                  {row.note}
                </span>
              </span>

              {/* The bar is drawn only when a real ratio exists. */}
              {pct != null ? (
                <span className="af-d2-exp-bar" aria-hidden>
                  <span
                    className={row.tone === 'bad' ? 'is-bad' : 'is-warn'}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </span>
              ) : null}

              <span className="af-d2-exp-share af-num">
                {row.exposure ?? '—'}
                {pct != null ? ` · ${pct}%` : ''}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="af-d2-exp-foot">
        Exposure is the share of your leagues carrying that player. This list is
        injury-led and capped at six — it shows what you are most exposed to that
        is currently a problem, not every player you roster.
      </p>
    </div>
  )
}

export default Exposure
