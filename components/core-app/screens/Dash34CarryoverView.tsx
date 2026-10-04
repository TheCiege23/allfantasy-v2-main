'use client'

import Link from 'next/link'
import { ClubLogo } from '@/components/core-app/ClubLogo'
import { Dash34When } from '@/components/core-app/screens/Dashboard34Live'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
import {
  briefCaveatText,
  briefHeadlineText,
  briefLineText,
  coarseCountdownText,
  coverageText,
  dash34FixedText,
  firstLockText,
  noticeBodyText,
} from '@/lib/core-app/homeBandsCopy'

/**
 * The words of Dash34Carryover and Dash34Coverage, in the reader's language (2026-10-04).
 *
 * Nearly every word here is written by dash34 on the SERVER, in English. Each sentence now carries
 * the `parts` it was built from and `homeBandsCopy` rebuilds it in Spanish here; a fixed label is a
 * fixed table. Anything without parts that the table does not know renders its English whole. The
 * coarse countdown's MINUTES are worked out by the band against `Date.now()` on the server, so both
 * sides of hydration agree; this only words them.
 */
type FirstLock = NonNullable<Dash34Data['firstLock']>
type Brief = NonNullable<Dash34Data['chimmyBrief']>
type Notice = NonNullable<Dash34Data['notice']>

/** The countdown: minutes the server measured, or the loader's own pre-formatted fallback. */
export type CarryoverCountdown = { mins: number } | { fallback: string }

function fixed(english: string, es: boolean): string {
  return es ? (dash34FixedText(english) ?? english) : english
}

export function Dash34CarryoverView({
  firstLock,
  countdown,
  notice,
  chimmyBrief,
}: {
  firstLock: FirstLock | null
  countdown: CarryoverCountdown | null
  notice: Notice | null
  chimmyBrief: Brief | null
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const lock = firstLock ? (es ? firstLockText(firstLock) : null) : null

  return (
    <div className="af-core af-carry">
      {firstLock ? (
        <section className="af-carry-lock" aria-label={es ? 'Lo más urgente' : 'Most urgent'}>
          <div className="af-carry-count">
            <span className="af-carry-count-l">{fixed(firstLock.countdownLabel ?? 'FIRST KICKOFF', es)}</span>
            <span className="af-carry-count-v af-num">
              {countdown && 'mins' in countdown ? coarseCountdownText(countdown.mins, language) : (countdown?.fallback ?? firstLock.countdown)}
            </span>
            <span className="af-carry-kick">
              {lock?.kickoffLabel ?? firstLock.kickoffLabel}
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
                  {/* The day goes with the label it ends: Spanish only beside a Spanish label. */}
                  <Dash34When iso={firstLock.countdownTo} language={lock ? language : undefined} />
                </>
              ) : null}
            </span>
          </div>
          <div className="af-carry-lockbody">
            <h2 className="af-carry-lockh">
              {/* Club marks are loader-gated to NFL; missing/failed renders text alone. */}
              <ClubLogo club={firstLock.awayClub ?? null} size={22} style={{ marginRight: '0.4em' }} />
              {lock?.headline ?? firstLock.headline}
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
            {lock?.openLabel ?? fixed(firstLock.openLabel, es)}
          </Link>
        </section>
      ) : null}

      {notice ? (
        <section className="af-carry-notice" role="status">
          <div className="af-carry-notice-b">
            <strong className="af-carry-notice-t">{fixed(notice.title, es)}</strong>
            <p className="af-carry-notice-p">{es ? (noticeBodyText(notice) ?? notice.body) : notice.body}</p>
          </div>
          {notice.href ? (
            <Link className="af-carry-open" href={notice.href}>
              {fixed(notice.label ?? 'Fix this', es)}
            </Link>
          ) : null}
        </section>
      ) : null}

      {chimmyBrief ? (
        <section className="af-carry-brief" aria-label={es ? 'Resumen de Chimmy' : 'Chimmy brief'}>
          <span className="af-carry-brief-l">{fixed(chimmyBrief.label, es)}</span>
          <h2 className="af-carry-brief-h">{es ? (briefHeadlineText(chimmyBrief) ?? chimmyBrief.headline) : chimmyBrief.headline}</h2>
          <ul className="af-carry-brief-lines">
            {chimmyBrief.lines.map((l) => (
              <li key={l.key} data-tone={l.tone ?? undefined}>
                {es ? (briefLineText(l.parts) ?? l.text) : l.text}
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
                      {/* A line still in English keeps an English day beside it — never half of one. */}
                      <Dash34When iso={l.atIso} language={es && briefLineText(l.parts) ? language : undefined} />
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="af-carry-caveat">{es ? (briefCaveatText(chimmyBrief) ?? chimmyBrief.caveat) : chimmyBrief.caveat}</p>
          {chimmyBrief.moreHref.startsWith('#') ? null : (
            /* moreHref can be an in-page anchor into Dashboard34 v2's markup
               (#af-d2-needs). No such id exists on the /core home — Dashboard3A
               renders the ranked list itself and is frozen — so a hash href
               here is a link that scrolls nowhere. The list it points at is
               already on screen directly below this card. */
            <Link className="af-carry-more" href={chimmyBrief.moreHref}>
              {fixed(chimmyBrief.moreLabel, es)}
            </Link>
          )}
        </section>
      ) : null}
    </div>
  )
}

/** The coverage footnote's words — see Dash34Coverage on why it sits at the foot of the page. */
export function Dash34CoverageView({ coverage }: { coverage: NonNullable<Dash34Data['coverage']> }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  return (
    <div className="af-core af-carry">
      <details className="af-carry-coverage">
        <summary>
          {es ? 'Lo que esta pantalla no vigila' : 'What this screen is not watching'} ({coverage.length})
        </summary>
        <ul>
          {coverage.map((c) => {
            const t = es ? (coverageText(c) ?? c) : c
            return (
              <li key={c.label}>
                <strong>{t.label}</strong> — {t.reason}
              </li>
            )
          })}
        </ul>
      </details>
    </div>
  )
}
