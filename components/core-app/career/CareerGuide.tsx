'use client'

import type { ReactNode } from 'react'
import { PageHeader } from '@/components/core-app/primitives/PageHeader'
import { useMessages } from '@/components/i18n/useMessages'
import { careerGuideMessages } from '@/lib/core-app/messages/careerGuide'
import { careerHeadline, careerSubline, survivalSummary } from '@/lib/core-app/careerGuide'
import type { CareerData } from '@/lib/core-app/careerModel'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import '@/components/core-app/career/af-career-guide.css'

/**
 * The /core/career guide pieces (2026-11-14): the page header that says what your career adds up to, the
 * "This season" section, and the folded survival scores. Copy is in lib/core-app/messages/careerGuide.ts.
 */
type Copy = typeof careerGuideMessages.en

const nf = (n: number) => n.toLocaleString(getAppIntlLocale())

export function careerHeadlineText(data: Parameters<typeof careerHeadline>[0], m: Copy): string {
  const h = careerHeadline(data)
  switch (h.kind) {
    case 'titles':
      return m.headTitles(h.titles, nf(h.titles), h.playoffs, nf(h.playoffs), h.since)
    case 'playoffs':
      return m.headPlayoffs(h.playoffs, nf(h.playoffs), h.since)
    case 'record':
      return m.headRecord(h.winPct, h.since)
    case 'empty':
      return m.headEmpty
    case 'filtered':
      return m.headFiltered
  }
}

/**
 * "@TheCiege26 · Level 14 All-Pro · 469 league-seasons across 5 sports · totals as of Nov 14, 1:17 AM ET".
 * The time is Eastern, as the stamp it replaces was, so server and client render the same string.
 */
export function careerSublineText(data: Parameters<typeof careerSubline>[0], builtAt: string | null, m: Copy): string {
  const s = careerSubline(data, builtAt)
  const when = s.builtAt
    ? new Date(s.builtAt).toLocaleString(getAppIntlLocale(), {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET'
    : null
  return [
    s.handle ? `@${s.handle}` : null,
    s.level != null ? m.level(s.level, s.levelName) : null,
    s.leagueSeasons > 0 ? m.leagueSeasons(nf(s.leagueSeasons), s.sports) : null,
    when ? m.totalsAsOf(when) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The top of every Career tab. It replaces the "YOUR CAREER · 2020—2025 · READ-ONLY · Totals as of…"
 * line, the "287 leagues · 469 league-seasons" stats beside the tabs, and the identity banner whose h1
 * — your handle — sat below a 1,100px survival table.
 */
export function CareerHead({ data, builtAt, actions }: { data: CareerData; builtAt: string | null; actions?: ReactNode }) {
  const m = useMessages(careerGuideMessages)
  const who = careerSublineText(data, builtAt, m)
  return (
    <PageHeader
      className="af-cg-head"
      eyebrow={m.eyebrow}
      title={careerHeadlineText(data, m)}
      testId="career-head"
      sub={
        <>
          {who ? <span className="af-cg-who">{who}</span> : null}
          <span className="af-cg-intro">{m.intro}</span>
        </>
      }
      actions={actions}
    />
  )
}

/** The account-wide, in-progress half of the overview, under one heading so a filtered page does not read it as filtered. */
export function CareerThisSeason({ children }: { children: ReactNode }) {
  const m = useMessages(careerGuideMessages)
  return (
    <section className="af-cg-season" aria-labelledby="af-cg-season-h" data-testid="career-this-season">
      <div className="af-cg-season-head">
        <h2 id="af-cg-season-h">{m.thisSeason}</h2>
        <p>{m.thisSeasonNote}</p>
      </div>
      {children}
    </section>
  )
}

/** "Survival scores · 30 elimination seasons · best 100.0", folded over the table it summarises. */
export function SurvivalFold({ results, children }: { results: CareerData['survivalResults']; children: ReactNode }) {
  const m = useMessages(careerGuideMessages)
  const s = survivalSummary(results)
  if (!s) return null
  return (
    <details className="af-c13-card af-cg-fold" data-testid="career-survival">
      <summary>
        <span className="af-cg-fold-title">{m.survival}</span>
        <span className="af-cg-fold-note">{m.survivalSummary(s.seasons, s.best != null ? s.best.toFixed(1) : null)}</span>
      </summary>
      {children}
    </details>
  )
}

/** The AF rank card's XP line — the Career XP card it absorbed said the same "XP to next" again. */
export function CareerXpLine({ xp, toNext, next }: { xp: number; toNext: number | null; next: string | null }) {
  const m = useMessages(careerGuideMessages)
  return <p className="af-c13-note">{m.xpLine(nf(xp), toNext != null ? nf(toNext) : null, next)}</p>
}

export function useCareerGuideCopy(): Copy {
  return useMessages(careerGuideMessages)
}
