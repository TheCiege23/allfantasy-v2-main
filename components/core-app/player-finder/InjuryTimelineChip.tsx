'use client'

import type { InjuryTimeline } from '@/lib/core-app/injuryTimeline'
import { finderPlayerInfoCopy, infoDateText, infoDesignationText } from '@/lib/core-app/finderPlayerInfoCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Beside the readiness chip on a player's card: which way his designation is moving and ESPN's
 * estimated return (lib/core-app/injuryTimeline.ts) — "↑ from Out · ESPN est. return Oct 5". Every
 * width, since the header is what a phone shows. Free: facts, with the estimate labelled as ESPN's.
 *
 * Spanish (2026-10-05): `timelineParts` takes the reader's language (English by default, unchanged).
 * The designation goes through `designationText` — singular, one player's status — and the date through
 * `kickoffText` ("Oct 5" → "5 oct").
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmt = (ymd: string) => DATE.format(new Date(`${ymd}T00:00:00Z`))

export function timelineParts(t: InjuryTimeline, language: string = 'en'): { short: string[]; sentence: string } {
  const c = finderPlayerInfoCopy(language)
  const date = (ymd: string) => infoDateText(fmt(ymd), language)
  const short: string[] = []
  const said: string[] = []
  if (t.previous) {
    const arrow = t.trend === 'up' ? '↑ ' : t.trend === 'down' ? '↓ ' : ''
    const status = infoDesignationText(t.previous.status, language)
    short.push(c.tlFrom(arrow, status))
    said.push(c.tlWas(t.trend, status, date(t.previous.lastReported)))
  }
  if (t.estReturn) {
    short.push(c.tlReturnShort(date(t.estReturn)))
    said.push(c.tlReturnSentence(date(t.estReturn)))
  }
  return { short, sentence: said.join(' ') }
}

export function InjuryTimelineChip({ timeline }: { timeline: InjuryTimeline | null | undefined }) {
  const { language } = useOptionalLanguage()
  if (!timeline) return null
  const { short, sentence } = timelineParts(timeline, language)
  if (short.length === 0) return null
  return (
    <span className="af-chip af-num af-pf-injtl" data-trend={timeline.trend ?? 'none'} title={sentence}>
      <span aria-hidden="true">{short.join(' · ')}</span>
      <span className="af-pf-injtl-sr">{sentence}</span>
    </span>
  )
}
