'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { relativeAge, type CardFreshnessStamp } from '@/lib/core-app/cardFreshness'
import { stampText } from '@/lib/core-app/cardFreshnessCopy'
import '@/components/core-app/home/af-core-home.css'

/**
 * One line at the foot of a /core home card: what its data is, and when that data last changed.
 * See lib/core-app/cardFreshness.ts for the rules — the time is always the DATA's, never the render's.
 *
 * The first paint is the server's label, so hydration matches; after that the label is re-derived
 * once a minute, because a home left open for an hour should not keep saying "just now".
 *
 * Spanish (2026-10-04): the stamps are built on the server in English; `stampText`
 * (lib/core-app/cardFreshnessCopy.ts) rebuilds each from its `parts`, its age through shellCopy's
 * `ageText`. A stamp it cannot rebuild stays whole English. The provider starts at English on server
 * and client alike, so the first paint still agrees.
 */
export function CardFreshness({ stamps }: { stamps: CardFreshnessStamp[] | null | undefined }) {
  const { language } = useOptionalLanguage()
  const [nowMs, setNowMs] = useState<number | null>(null)
  useEffect(() => {
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!stamps || stamps.length === 0) return null
  const anyStale = stamps.some((s) => s.stale)
  return (
    <p className="af-cardfresh" data-stale={anyStale ? 'true' : 'false'}>
      {stamps.map((stamp, index) => {
        const t = stampText(stamp, language) ?? stampText(stamp, 'en')!
        const label =
          stamp.asOf == null
            ? null
            : nowMs == null
              ? stamp.label
              : relativeAge(Date.parse(stamp.asOf), nowMs)
        return (
          <span key={stamp.source} className="af-cardfresh-item">
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            {stamp.stale ? <span aria-hidden="true">⚠ </span> : null}
            {t.source}{' '}
            {stamp.asOf == null ? (
              <span>{t.missing}</span>
            ) : (
              <time dateTime={stamp.asOf} title={stamp.asOf}>
                {t.updated} {label == null ? null : t.age(label)}
              </time>
            )}
            {t.after}
            {stamp.stale && stamp.asOf != null ? <span className="af-sr-only"> ({t.outOfDate})</span> : null}
          </span>
        )
      })}
    </p>
  )
}

export default CardFreshness
