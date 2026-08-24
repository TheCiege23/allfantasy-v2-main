import Link from 'next/link'
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
export function Dash34Carryover({ data }: { data: Dash34Data | null }) {
  if (!data) return null
  const { firstLock, notice, chimmyBrief, coverage } = data
  if (!firstLock && !notice && !chimmyBrief && (!coverage || coverage.length === 0)) return null

  return (
    <div className="af-core af-carry">
      {firstLock ? (
        <section className="af-carry-lock" aria-label="Most urgent">
          <div className="af-carry-count">
            <span className="af-carry-count-l">{firstLock.countdownLabel ?? 'FIRST KICKOFF'}</span>
            <span className="af-carry-count-v af-num">{firstLock.countdown}</span>
            <span className="af-carry-kick">{firstLock.kickoffLabel}</span>
          </div>
          <div className="af-carry-lockbody">
            <h2 className="af-carry-lockh">{firstLock.headline}</h2>
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
              </li>
            ))}
          </ul>
          <p className="af-carry-caveat">{chimmyBrief.caveat}</p>
          <Link className="af-carry-more" href={chimmyBrief.moreHref}>
            {chimmyBrief.moreLabel}
          </Link>
        </section>
      ) : null}

      {coverage && coverage.length > 0 ? (
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
      ) : null}
    </div>
  )
}
