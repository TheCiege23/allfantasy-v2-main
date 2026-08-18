import { Dash34Ago, Dash34When } from '@/components/core-app/screens/Dashboard34Live'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * Moving your book — how much of your account rides on one player.
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
 * that reads "exposure" otherwise implies you only roster six people. That
 * caveat is now ALSO on the section header's "?" affordance, because the footnote
 * sits below six rows and the misreading happens at the top of the list.
 *
 * ⚠ THE BADGE IS TINTED FROM `tone`, NOT FROM A POSITION LOOKUP. The design shows
 * two players in two different colours; those colours are severity (cannot play /
 * can still play), which the loader already decides in one place and which
 * `lib/core-app/dash34.ts` documents at length. Colouring by position instead
 * would need a QB/RB/WR palette this product does not have, and would put a
 * second, disagreeing definition of "bad" on the screen.
 *
 * ⚠ THE FRESHNESS LINE IS A REAL TIMESTAMP OR IT IS ABSENT. `reportedAt` is
 * `SportsInjury.date` — the provider's own stamp, non-null on all 5,209
 * production rows but not guaranteed — and it is never back-filled from our poll
 * time or from `now`. Rendering it needs the two-pass client swap or the elapsed
 * time computed on the server and on the reader's machine disagree and hydration
 * fails; `Dash34Ago` takes the server's string as its first paint for exactly
 * that reason.
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
          const tone = row.tone === 'bad' ? 'bad' : 'warn'

          /*
           * The status half of the row. `position` and `status` are emitted
           * separately now, so the badge can carry the slot and this line can
           * carry the designation — but `note` is still the fallback for a row
           * the loader wrote before the split, rather than rendering an empty
           * line.
           */
          const statusText = row.status ?? row.note

          return (
            <li key={row.name} className="af-d2-exp-row">
              {/*
                Initials, tinted by severity. `data-tone` rather than a class per
                colour so the CSS carries one rule per tone and the component
                carries none of the palette.
              */}
              <span className="af-d2-exp-mark af-num" data-tone={tone} aria-hidden>
                {row.initials}
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
                The count carries the same tint as the badge, so a row reads as
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
                  <span className="af-d2-exp-share-start">
                    {row.startingIn} starting
                  </span>
                ) : null}
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
