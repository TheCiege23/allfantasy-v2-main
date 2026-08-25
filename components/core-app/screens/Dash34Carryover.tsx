import Link from 'next/link'
import { ClubLogo } from '@/components/core-app/ClubLogo'
import { Dash34When } from '@/components/core-app/screens/Dashboard34Live'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-carryover.css'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'

/**
 * The 34a home sections Dashboard3A does not render, carried over so the /core
 * cutover loses nothing (the parity rule: less is fine only when it is chosen,
 * and these four were not up for losing):
 *
 *   - firstLock  — the most-time-critical band with the next real kickoff.
 *   - notice     — the one-account-wide honesty card ("sync has never run"),
 *                  the 604-row fix; dropping it would un-fix that.
 *   - chimmyBrief — the deterministic brief, the 34a hero.
 *   - coverage   — what this screen is NOT watching. A quiet dashboard that
 *                  doesn't name its blind spots reads as "everything is fine".
 *
 * Deliberately NOT carried over (covered elsewhere on the unified home, listed
 * for sign-off in the cutover PR): today/next-24 strips (Outstanding issues
 * carries the same "what needs you" facts) and the per-league state chips
 * (STARTERS OUT lives in the triage panel above; DRAFTING/YOU COMMISH surface
 * on each league's own screens).
 *
 * A separate component because Dashboard3A.tsx carries another session's
 * in-flight work and is not edited. Countdown renders the server paint
 * statically — the triage panel above already carries live kickoff urgency.
 */
/**
 * Static server paint, deliberately coarse. No ticker mounts here — the triage
 * panel above carries live kickoff urgency, and the 34a page keeps the precise
 * Dash34Countdown — so a to-the-minute '3d 02:48' would sit frozen and read as
 * a live clock that stopped. 'in 3d 3h' is honest about its own precision.
 * Falls back to the loader's pre-formatted string when no ISO target exists.
 */
function coarseCountdown(toIso: string | null | undefined, fallback: string): string {
  if (!toIso) return fallback
  const t = new Date(toIso).getTime()
  if (Number.isNaN(t)) return fallback
  const mins = Math.floor((t - Date.now()) / 60000)
  if (mins <= 0) return 'underway'
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours - days * 24
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`
}

export function Dash34Carryover({ data }: { data: Dash34Data | null }) {
  if (!data) return null
  const { firstLock, notice, chimmyBrief } = data
  /*
   * Coverage no longer counts toward this guard — it renders at the foot of
   * the page now (Dash34Coverage). The brief still keeps this band alive in
   * the quiet case, deliberately: with nothing to report its headline reads
   * "Nothing is waiting on you", and hiding it would leave a reader unable to
   * tell "we checked and it is clear" from "we are not looking".
   */
  if (!firstLock && !notice && !chimmyBrief) return null

  return (
    <div className="af-core af-carry">
      {firstLock ? (
        <section className="af-carry-lock" aria-label="Most urgent">
          <div className="af-carry-count">
            <span className="af-carry-count-l">{firstLock.countdownLabel ?? 'FIRST KICKOFF'}</span>
            <span className="af-carry-count-v af-num">
              {coarseCountdown(firstLock.countdownTo, firstLock.countdown)}
            </span>
            <span className="af-carry-kick">
              {firstLock.kickoffLabel}
              {/*
                The instant, in the READER'S zone. It used to be baked into the
                label above as a raw UTC stamp, on the one line someone sets an
                alarm by, while the bands around it localised — three zones on
                one screen. Dash34When paints UTC on the server and swaps in the
                local rendering after hydration, so the two passes agree.
              */}
              {firstLock.countdownTo ? (
                <>
                  {' · '}
                  <Dash34When iso={firstLock.countdownTo} />
                </>
              ) : null}
            </span>
          </div>
          <div className="af-carry-lockbody">
            <h2 className="af-carry-lockh">
              {/* Club marks are loader-gated to NFL; missing/failed renders text alone. */}
              <ClubLogo club={firstLock.awayClub ?? null} size={22} style={{ marginRight: '0.4em' }} />
              {firstLock.headline}
              <ClubLogo club={firstLock.homeClub ?? null} size={22} style={{ marginLeft: '0.4em' }} />
            </h2>
            {firstLock.slots.length > 0 ? (
              <div className="af-carry-slots">
                {firstLock.slots.map((s, i) => (
                  <span key={s.key ?? i} className="af-carry-slot" data-tone={s.tone ?? undefined}>
                    {s.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <Link className="af-carry-open" href={firstLock.openHref}>
            {firstLock.openLabel}
          </Link>
        </section>
      ) : null}

      {notice ? (
        <section className="af-carry-notice" role="status">
          <div className="af-carry-notice-b">
            <strong className="af-carry-notice-t">{notice.title}</strong>
            <p className="af-carry-notice-p">{notice.body}</p>
          </div>
          {notice.href ? (
            <Link className="af-carry-open" href={notice.href}>
              {notice.label ?? 'Fix this'}
            </Link>
          ) : null}
        </section>
      ) : null}

      {chimmyBrief ? (
        <section className="af-carry-brief" aria-label="Chimmy brief">
          <span className="af-carry-brief-l">{chimmyBrief.label}</span>
          <h2 className="af-carry-brief-h">{chimmyBrief.headline}</h2>
          <ul className="af-carry-brief-lines">
            {chimmyBrief.lines.map((l) => (
              <li key={l.key} data-tone={l.tone ?? undefined}>
                {l.text}
                {/*
                  The instant the line ends with — dash34 emits the kickoff line
                  as `text: '<name> plays next at'` plus `atIso`, so rendering
                  only `l.text` printed a truncated sentence. Same split and the
                  same client localiser as ChimmyBrief: the server cannot know
                  the reader's zone, and this is the value someone sets an
                  alarm by.
                */}
                {l.atIso ? (
                  <>
                    {' '}
                    <span className="af-carry-brief-at af-num">
                      <Dash34When iso={l.atIso} />
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="af-carry-caveat">{chimmyBrief.caveat}</p>
          {chimmyBrief.moreHref.startsWith('#') ? null : (
            /* moreHref can be an in-page anchor into Dashboard34 v2's markup
               (#af-d2-needs). No such id exists on the /core home — Dashboard3A
               renders the ranked list itself and is frozen — so a hash href
               here is a link that scrolls nowhere. The list it points at is
               already on screen directly below this card. */
            <Link className="af-carry-more" href={chimmyBrief.moreHref}>
              {chimmyBrief.moreLabel}
            </Link>
          )}
        </section>
      ) : null}

    </div>
  )
}

/**
 * What this screen is NOT watching — the same disclosure, moved to the foot of
 * the page.
 *
 * ⚠ IT IS A FOOTNOTE, AND IT WAS SITTING THIRD. Leading a home screen with a
 * list of everything we cannot see sets the tone of the whole page to apology,
 * before the reader has seen a single thing the product DOES know. It belongs
 * after the answers, where someone who has read them and wants to know what
 * was left out can find it — which is exactly what a collapsed disclosure at
 * the bottom is for. Nothing about the content changed; only where it sits.
 */
export function Dash34Coverage({ data }: { data: Dash34Data | null }) {
  const coverage = data?.coverage
  if (!coverage || coverage.length === 0) return null
  return (
    <div className="af-core af-carry">
      <details className="af-carry-coverage">
        <summary>What this screen is not watching ({coverage.length})</summary>
        <ul>
          {coverage.map((c) => (
            <li key={c.label}>
              <strong>{c.label}</strong> — {c.reason}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
