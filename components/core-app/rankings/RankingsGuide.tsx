'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { rankingsGuideMessages } from '@/lib/core-app/messages/rankingsGuide'
import { movementParts, type RankingsHeadline } from '@/lib/core-app/rankingsGuide'
import type { Movement, RankingsData } from '@/lib/core-app/rankings'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import '@/components/core-app/rankings/af-rankings-guide.css'

/**
 * The /core/rankings guide pieces (2026-11-14) — client only because the copy is in the reader's language
 * (lib/core-app/messages/rankingsGuide.ts). The screen (components/core-app/screens/Rankings.tsx) stays
 * server-rendered and passes plain data in.
 */
type Copy = typeof rankingsGuideMessages.en

export function headlineText(h: RankingsHeadline, m: Copy): string {
  const n = (v: number) => v.toLocaleString(getAppIntlLocale(), { maximumFractionDigits: 1 })
  switch (h.kind) {
    case 'board':
      if (h.rank === 1) return m.headTop(h.of, h.board)
      return h.next?.gap != null ? m.headBehind(h.rank, h.of, n(h.next.gap), h.next.handle) : m.headBoard(h.rank, h.of, h.board)
    case 'notRanked':
      return m.headNotRanked(h.min)
    case 'portfolio':
      return m.headPortfolio(n(h.score), h.rank?.rank ?? null, h.rank?.of ?? null)
    case 'portfolioEmpty':
      return m.headPortfolioEmpty
    case 'league':
      return m.headLeague(h.rank, h.of, h.league)
    case 'leaguePick':
      return m.headLeaguePick
    case 'class':
      return m.headClass(h.division, n(h.rating))
    case 'classProvisional':
      return m.headClassProvisional(h.games)
    case 'about':
      return h.scope === 'portfolio'
        ? m.headAboutPortfolio
        : h.scope === 'league'
          ? m.headAboutLeague
          : h.scope === 'class'
            ? m.headAboutClass
            : m.headAboutGlobal
  }
}

export function introText(scope: RankingsData['scope'], m: Copy): string {
  return scope === 'portfolio' ? m.introPortfolio : scope === 'league' ? m.introLeague : scope === 'class' ? m.introClass : m.introGlobal
}

/** "up 1 this week · down 13 since last season" — nothing when nothing moved or nothing is known. */
export function movementText(movement: Movement | null | undefined, m: Copy): string | null {
  const parts = movementParts(movement).map((p) =>
    p.window === 'week' ? m.moveWeek(p.places) : p.window === 'sevenDay' ? m.moveSevenDay(p.places) : m.moveSeason(p.places),
  )
  if (parts.length === 0) return null
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/**
 * Under the headline on the community board: how your place has moved, and the two things to do about
 * it. Replaces the "You on Overall #18 of 19" box, whose rank the headline now says, and its "My
 * portfolio" button, which repeated the tab right above it.
 */
export function RankingsYouRow({
  movement,
  whyHref,
  chimmyHref,
  extra = null,
}: {
  movement: Movement | null
  whyHref: string | null
  chimmyHref: string
  /** The page's own buttons (Share rank card, How ranking works), so every button is in one row. */
  extra?: ReactNode
}) {
  const m = useMessages(rankingsGuideMessages)
  const line = movementText(movement, m)
  return (
    <section className="af-rk-yourow" aria-label={m.movementAria} data-testid="rk-yourow">
      {line ? <p className="af-rk-yourow-move">{line}</p> : null}
      <div className="af-rk-headact">
        {whyHref ? (
          <Link className="af-rk-btn" href={whyHref} scroll={false}>
            {m.whyRank}
          </Link>
        ) : null}
        <a className="af-rk-btn" href={chimmyHref}>
          {m.askChimmy}
        </a>
        {extra}
      </div>
    </section>
  )
}

/**
 * The one line under the community board — who is ranked, who is not yet, and when it was worked out —
 * with "How this board is scored" folded beneath it (the weights, the movement window and the data it
 * was built from, passed in as `children`). Replaces two notes, a Freshness line, the board head's
 * weight legend and the method card, which between them said the weights and the time twice.
 */
export function RankingsBoardFoot({
  shown,
  population,
  belowSample,
  minSample,
  updated,
  children,
}: {
  shown: number
  population: number
  belowSample: number
  minSample: number
  updated: string
  children: ReactNode
}) {
  const m = useMessages(rankingsGuideMessages)
  const parts = [
    population > 0 ? m.boardLine(shown, population) : null,
    belowSample > 0 ? m.boardBelow(belowSample, minSample) : null,
    m.boardUpdated(updated),
  ].filter(Boolean)
  return (
    <div className="af-rk-boardfoot" data-testid="rk-boardfoot">
      <p className="af-rk-boardfoot-line">{parts.join(' · ')}</p>
      <details className="af-rk-howscored" id="rk-how-scored">
        <summary>{m.howScored}</summary>
        <div className="af-rk-howscored-body">{children}</div>
      </details>
    </div>
  )
}

/** "Filters · All leagues" — the summary of the folded filter form (RankingsFilterBar). */
export function RankingsFilterSummary({ label, changed }: { label: string; changed: number }) {
  const m = useMessages(rankingsGuideMessages)
  return (
    <>
      {m.filters} · {changed > 0 ? label : m.filtersAll}
    </>
  )
}
