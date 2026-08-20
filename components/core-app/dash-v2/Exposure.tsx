import { Dash34Ago, Dash34When } from '@/components/core-app/screens/Dashboard34Live'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Moving your book — how much of your account rides on one player, where, and
 * how urgent it is.
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
 * is every player I roster". The footnote says so, and so does the "?" on the
 * section header — the footnote sits below forty rows, which is after the
 * misreading has already happened.
 *
 * ⚠ THE MARK CARRIES SEVERITY, AND IT DEGRADES ON PURPOSE. `data-tone` is the
 * loader's own bad/warn call — "cannot enter a lineup" against "might be
 * limited" — set on the mark whether or not a headshot exists. With a photo the
 * tinted fill is hidden behind it and only the coloured ring reads; with initials
 * the fill and the text carry the tone too. One attribute, both states, and no
 * tinting of a photograph.
 *
 * ⚠ THE FRESHNESS LINE IS A REAL TIMESTAMP OR IT IS ABSENT. `reportedAt` is
 * `SportsInjury.date` — the provider's own stamp — and it is never back-filled
 * from our poll time or from `now`. Rendering it needs the two-pass client swap
 * or the elapsed time computed on the server and on the reader's machine
 * disagree and hydration fails; `Dash34Ago` takes the server's string as its
 * first paint for exactly that reason.
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
          const tone = row.tone === 'bad' ? 'bad' : 'warn'

          /*
           * `position` and `status` are emitted separately now, so the badge can
           * carry the slot and this line can carry the designation — but `note`
           * remains the fallback rather than rendering an empty line.
           */
          const statusText = row.status ?? row.note

          return (
            <li key={row.name} className="af-d2-exp-item">
              <div className="af-d2-exp-row">
                <span className="af-d2-exp-mark" data-tone={tone} aria-hidden>
                  {row.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.imageUrl} alt="" />
                  ) : (
                    <span className="af-num">{row.initials}</span>
                  )}
                </span>

                <span className="af-d2-exp-text">
                  <span className="af-d2-exp-head">
                    <span className="af-d2-exp-name">{row.name}</span>
                    {/*
                      Position and club, when the feed carries them. Omitted rather
                      than filled with a dash — an empty badge reads as a slot we
                      failed to load rather than one the provider never sent.
                    */}
                    {row.position || row.team ? (
                      <span className="af-d2-exp-pos af-num" data-tone={tone}>
                        {[row.position, row.team].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </span>

                  <span className={`af-d2-exp-note af-num is-${tone}`}>
                    {statusText}
                    {/*
                      Freshness, only when a real report date exists. `reportedAgo`
                      is the server's string and is what paints first; Dash34Ago
                      re-derives from the ISO after hydration.
                    */}
                    {row.reportedAt && row.reportedAgo ? (
                      <>
                        {' · '}
                        <span className="af-d2-exp-ago">
                          <Dash34Ago iso={row.reportedAt} initial={row.reportedAgo} />
                        </span>
                      </>
                    ) : null}
                  </span>

                  {/*
                    When they next play. NFL only — the loader gates the club-code
                    join on sport because those codes collide across leagues. This
                    is the fixture list, NOT a lineup lock, and it is worded as a
                    kickoff so it cannot be read as one.
                  */}
                  {row.nextKickoffAt ? (
                    <span className="af-d2-exp-next af-num">
                      KICKS OFF <Dash34When iso={row.nextKickoffAt} />
                    </span>
                  ) : null}
                </span>

                {/* The bar is drawn only when a real ratio exists. */}
                {pct != null ? (
                  <span className="af-d2-exp-bar" aria-hidden>
                    <span
                      className={tone === 'bad' ? 'is-bad' : 'is-warn'}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </span>
                ) : null}

                {/*
                  The count carries the same tint as the mark, so a row reads as
                  one object rather than as a coloured avatar beside a grey number.
                */}
                <span className={`af-d2-exp-share af-num is-${tone}`}>
                  <span className="af-d2-exp-share-count">{row.exposure ?? '—'}</span>
                  {pct != null ? <span className="af-d2-exp-share-pct">{pct}%</span> : null}
                  {/*
                    "starting in N" is a different and more urgent number than "in N
                    leagues", and it is the one that decides whether this needs you
                    today. Shown only when it is non-zero — "starting in 0" is
                    already said by its absence.
                  */}
                  {row.startingIn != null && row.startingIn > 0 ? (
                    <span className="af-d2-exp-share-start">{row.startingIn} starting</span>
                  ) : null}
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
