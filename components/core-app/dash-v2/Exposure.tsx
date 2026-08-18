import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Player exposure — how much of your account rides on one player, and where.
 *
 * Wired to dash34's `book`, which walks every claimed roster and groups by
 * player. The loader emits the ratio as numbers alongside the human string, so
 * the share bar is computed rather than parsed back out of "7 of 61" — a display
 * string is not a data source.
 *
 * ⚠ THE LEAGUE LIST IS THE POINT, NOT DECORATION. "7 of 61" tells you the size of
 * a problem and nothing about where it is. Naming the seven — with each league's
 * own avatar and platform — is what makes the row actionable without opening
 * seven leagues to find them. It is a <details> so the page stays scannable at
 * forty players and the detail is one click away.
 *
 * ⚠ THE BOOK IS INJURY-LED. dash34 builds it from players carrying a status worth
 * flagging, ordered by unavailability then by how many leagues carry them. So
 * this answers "what am I most exposed to that is currently a problem", not "here
 * is every player I roster". The footnote says so, because a list under a header
 * reading "exposure" otherwise implies it is the whole roster.
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
          const leagues = row.leagues ?? []
          const tone = row.tone === 'bad' ? 'is-bad' : 'is-warn'

          return (
            <li key={row.name} className="af-d2-exp-item">
              <div className="af-d2-exp-row">
                <span className="af-d2-exp-mark" aria-hidden>
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.imageUrl} alt="" />
                  ) : (
                    <span className="af-num">{row.initials}</span>
                  )}
                </span>

                <span className="af-d2-exp-text">
                  <span className="af-d2-exp-name">{row.name}</span>
                  <span className={`af-d2-exp-note af-num ${tone}`}>{row.note}</span>
                </span>

                {pct != null ? (
                  <span className="af-d2-exp-bar" aria-hidden>
                    <span className={tone} style={{ width: `${Math.max(2, pct)}%` }} />
                  </span>
                ) : null}

                <span className="af-d2-exp-share af-num">
                  {row.exposure ?? '—'}
                  {pct != null ? ` · ${pct}%` : ''}
                </span>
              </div>

              {leagues.length > 0 ? (
                <details className="af-d2-exp-leagues">
                  <summary className="af-d2-exp-leagues-toggle af-num">
                    {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}
                  </summary>
                  <ul className="af-d2-exp-league-list">
                    {leagues.map((lg) => (
                      <li key={lg.id} className="af-d2-exp-league">
                        <span className="af-d2-exp-league-tile" aria-hidden>
                          {lg.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={lg.imageUrl} alt="" />
                          ) : (
                            lg.name.trim().slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <span className="af-d2-exp-league-name">{lg.name}</span>
                        {lg.platform ? (
                          <span className="af-d2-exp-league-plat af-num">{lg.platform}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          )
        })}
      </ul>

      <p className="af-d2-exp-foot">
        Exposure is the share of your leagues carrying that player, ordered by how
        many. This list is injury-led — it shows what you are most exposed to that
        is currently a problem, not every player you roster.
      </p>
    </div>
  )
}

export default Exposure
