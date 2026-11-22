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
import type { RankingsData, YourRank } from '@/lib/core-app/rankings'
import type { RankingsHeadline } from '@/lib/core-app/rankingsGuide'
import { rankingsGuideMessages } from '@/lib/core-app/messages/rankingsGuide'
import { headlineText, introText } from '@/components/core-app/rankings/RankingsGuide'

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
  headline,
  scope,
  belowHead,
  showLevel,
}: {
  /**
   * "Calculated … from N ranked managers" — formatted by the screen. Null on the community board, whose
   * own line under the board says when it was worked out (2026-11-14).
   */
  computedLine: ReactNode | null
  actions: ReactNode | null
  you: YourRank
  /**
   * 2026-11-14: the h1 says where you stand on the tab you are on (lib/core-app/rankingsGuide.ts). It
   * used to be "Rankings" over two sentences, with "#18 of 19 · Community" and your level as pills —
   * the rank said again in a box, the board heading and the row below, the level again in the card.
   */
  headline: RankingsHeadline
  scope: RankingsData['scope']
  /** Under the intro: how your place has moved and what to do about it (RankingsYouRow). */
  belowHead?: ReactNode
  showLevel: boolean
}) {
  const m = useMessages(rankingsHeroMessages)
  const g = useMessages(rankingsGuideMessages)
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
          eyebrow={g.eyebrow}
          title={headlineText(headline, g)}
          /*
            After the intro, not beside the title: a headline that says where you stand is long enough to
            wrap, and the buttons then landed between it and its sentence. Absent when the row under the
            intro (RankingsYouRow) carries them.
          */
          actions={actions ? <div className="af-rk-headact">{actions}</div> : undefined}
          sub={introText(scope, g)}
        />
        {belowHead}
        {computedLine ? <p className="af-rk-sub">{computedLine}</p> : null}
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

/**
 * The Community board's head: what the board is, in one sentence (2026-11-14). The population line and
 * your rank moved to the line under the board and the headline; the weight legend moved into "How this
 * board is scored" under it (RankingsBoardFoot) — each was said twice.
 */
export function RankingsBoardHead() {
  const m = useMessages(rankingsHeroMessages)
  return (
    <div className="af-rk-boardhead" data-testid="rk-boardhead">
      <div className="af-rk-boardhead-main">
        <h2 className="af-rk-boardhead-title">{m.boardTitle}</h2>
        <p className="af-rk-boardhead-explain">{m.boardExplain}</p>
      </div>
    </div>
  )
}
