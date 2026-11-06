'use client'

import type { ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { PageHeader } from '@/components/core-app/primitives/PageHeader'
import { rankingsHeroMessages } from '@/lib/core-app/messages/rankingsHero'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import {
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'
import { SCORE_WEIGHTS } from '@/lib/core-app/rankingsEngine'
import type { YourRank } from '@/lib/core-app/rankings'

/**
 * Rankings hero (redraft Rankings board, 2026-11-01): eyebrow, title and the one-sentence promise
 * that every rank names its board, a "where you stand" pill row, and — on every scope but My
 * portfolio, which carries the full level card in its body — a dark level card.
 *
 * ⚠ THE XP CHIPS ARE THE PUBLISHED RULES, NOT THE BOARD'S. The board's mock earned XP for lineups
 * and trades; this app's ladder earns it for wins, playoff berths, seasons and titles
 * (lib/rank/rank-xp-constants.ts), so the chips read those constants rather than restating a rule
 * that does not exist.
 */
export function RankingsHero({
  computedLine,
  actions,
  you,
  community,
  showLevel,
}: {
  /** "Calculated … from N ranked managers" — formatted by the screen. */
  computedLine: ReactNode
  actions: ReactNode
  you: YourRank
  /** Your place on the Community board, when you are on it. */
  community: { rank: number; of: number } | null
  showLevel: boolean
}) {
  const m = useMessages(rankingsHeroMessages)
  const n = (v: number) => v.toLocaleString(getAppIntlLocale())
  const earn: Array<[string, number]> = [
    [m.earnWin, RANK_XP_PER_IMPORT_WIN],
    [m.earnPlayoff, RANK_XP_PER_PLAYOFF_APPEARANCE],
    [m.earnSeason, RANK_XP_PER_DISTINCT_SEASON],
    [m.earnTitle, RANK_XP_PER_CHAMPIONSHIP],
  ]
  return (
    // A section, not a header: the page header is the PageHeader inside it (a header may not nest a header).
    <section className="af-rk-hero" data-testid="rk-hero">
      <div className="af-rk-hero-main">
        <PageHeader
          className="af-rk-hero-head"
          eyebrowClassName="af-rk-hero-eyebrow"
          titleRowClassName="af-rk-hero-titlerow"
          titleClassName="af-rk-title"
          subClassName="af-rk-hero-intro"
          eyebrow={m.eyebrow}
          title="Rankings"
          titleAside={<div className="af-rk-headact">{actions}</div>}
          sub={
            <>
              {m.intro1}
              <strong>{m.why}</strong>
              {m.intro2}
            </>
          }
        />
        {community || you ? (
          <ul className="af-rk-pills" aria-label={m.summaryAria} data-testid="rk-pills">
            {community ? (
              <li>
                <b>#{community.rank}</b>
                <span>{m.communityPill(n(community.of))}</span>
              </li>
            ) : null}
            {you ? (
              <li>
                <b>{you.level}</b>
                <span>{m.levelPill(you.levelName)}</span>
              </li>
            ) : null}
          </ul>
        ) : null}
        <p className="af-rk-sub">{computedLine}</p>
      </div>

      {showLevel && you ? (
        <section className="af-rk-levelcard" aria-label={m.levelEyebrow} data-testid="rk-levelcard">
          <div className="af-rk-levelcard-top">
            <span>{m.levelEyebrow}</span>
            <span>{m.levelOf(you.level, you.totalLevels)}</span>
          </div>
          <p className="af-rk-levelcard-name">{you.levelName}</p>
          <div className="af-rk-levelcard-xp">
            <b>{n(you.xp)} XP</b>
            <span>{you.xpToNext != null && you.nextLevelName ? m.xpTo(n(you.xpToNext), you.nextLevelName) : m.lastRung}</span>
          </div>
          <div
            className="af-rk-levelcard-bar"
            role="progressbar"
            aria-label={m.xpAria}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={you.progressPct}
          >
            <i style={{ width: `${Math.max(0, Math.min(100, you.progressPct))}%` }} />
          </div>
          <ul className="af-rk-earn" aria-label={m.earnAria}>
            {earn.map(([label, xp]) => (
              <li key={label}>
                {label} <b>+{xp}</b>
              </li>
            ))}
          </ul>
          <p className="af-rk-levelcard-note">{m.levelNote}</p>
        </section>
      ) : null}
    </section>
  )
}

const LEGEND: Array<{ key: keyof typeof SCORE_WEIGHTS; tone: number }> = [
  { key: 'winRate', tone: 1 },
  { key: 'scoring', tone: 2 },
  { key: 'titles', tone: 3 },
  { key: 'playoffs', tone: 4 },
]

/**
 * The Community board's head: what the board is, how many it ranks, and — on Overall only, the one
 * board scored as a blend — the score equation with each component's published weight.
 */
export function RankingsBoardHead({
  shown,
  population,
  you,
  overall,
}: {
  shown: number
  population: number
  you: { rank: number; of: number } | null
  overall: boolean
}) {
  const m = useMessages(rankingsHeroMessages)
  return (
    <div className="af-rk-boardhead" data-testid="rk-boardhead">
      <div className="af-rk-boardhead-main">
        <h2 className="af-rk-boardhead-title">{m.boardTitle}</h2>
        <p className="af-rk-boardhead-explain">{m.boardExplain}</p>
        <p className="af-rk-boardhead-pop">
          <span>{m.boardPopulation(shown, population)}</span>
          {you ? <span>{m.boardYou(you.rank, you.of)}</span> : null}
        </p>
      </div>
      {overall ? (
        <div className="af-rk-legend">
          <span className="af-rk-legend-eq">{m.scoreEq}</span>
          <ul aria-label={m.legendAria}>
            {LEGEND.map((l) => (
              <li key={l.key} data-tone={l.tone}>
                <i aria-hidden="true" />
                {m[l.key]} <b>{Math.round(SCORE_WEIGHTS[l.key] * 100)}%</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
