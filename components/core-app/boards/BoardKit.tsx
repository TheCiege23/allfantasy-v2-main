import Link from 'next/link'
import type { ReactNode } from 'react'

import '@/components/core-app/af-core-boards.css'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { messagesFor } from '@/lib/i18n/messages'
import { boardKitMessages } from '@/lib/core-app/messages/boardKit'

/**
 * The shared parts of every cross-league board in the 2026-09-07 core-pages
 * handoff. Fifteen designs, three primitives: a page head, a section header
 * that STATES its ranking rule, and a footer line accounting for the leagues
 * the list did not show — plus the two image primitives (league crest, player
 * headshot) that carry the art through all of them.
 *
 * Most primitives remain server components. PlayerFace is a small client island
 * so a failed external headshot or club crest can fall back cleanly.
 */

/* ── monograms ───────────────────────────────────────────────────────────── */

/**
 * A two-character mark for a league with no artwork.
 *
 * ⚠ INITIALS OF THE WORDS, NOT THE FIRST TWO LETTERS. "Dynasty Dragons" is DD,
 * not DY, and on an account holding "Guillotine League 26 ($20/1)" through
 * "($20/3)" the first-two-letters rule renders four identical marks. Digits
 * count as words for exactly that reason.
 */
export function leagueMark(name: string | null | undefined): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** Initials for a person or team name. Same rule, one or two characters. */
export function personMark(name: string | null | undefined): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Lower-cased platform key for the `data-platform` tints, or undefined. */
export function platformKey(p: string | null | undefined): string | undefined {
  const k = String(p ?? '').trim().toLowerCase()
  return k.length > 0 ? k : undefined
}

/* ── page head ───────────────────────────────────────────────────────────── */

export function BoardHead({
  eyebrow,
  title,
  blurb,
}: {
  eyebrow: string
  title: string
  blurb: string
}) {
  return (
    <header className="af-bd-head">
      <p className="af-bd-eyebrow">{eyebrow}</p>
      <h1 className="af-bd-title">{title}</h1>
      <p className="af-bd-blurb">{blurb}</p>
    </header>
  )
}

/* ── section header ──────────────────────────────────────────────────────── */

/**
 * ⚠ `label` MUST NAME THE RANKING RULE. Every ranked list in the handoff says
 * how it is ordered — "TOP 10 · RANKED BY URGENCY", "SORTED BY LEAGUES
 * AFFECTED". A list of ten things out of eighty that does not say why those ten
 * is the thing this whole batch replaced.
 */
export function SectionHead({
  label,
  count,
  id,
  tone,
  info,
}: {
  label: string
  count?: string | null
  id?: string
  /**
   * Colours the label by what the section holds — LEADING green, TRAILING red,
   * ON THE BUBBLE amber (handoff 2026-09-13). Omit for a neutral section.
   */
  tone?: 'good' | 'bad' | 'warn'
  /**
   * An `InfoTip` explaining how to read the section — one for the whole list, never one per row.
   *
   * ⚠ BESIDE THE HEADING, NOT INSIDE IT. Sections are `aria-labelledby` this `<h2>`, so a button
   * inside it would join every section's accessible name ("Top 10 · ranked by urgency How to read
   * this list").
   */
  info?: ReactNode
}) {
  return (
    <div className="af-bd-sec-head">
      <h2 className="af-bd-sec-label" id={id} data-tone={tone}>
        {label}
      </h2>
      {info ? <span className="af-bd-sec-info">{info}</span> : null}
      <span className="af-bd-sec-rule" aria-hidden />
      {count ? <span className="af-bd-sec-count">{count}</span> : null}
    </div>
  )
}

/* ── footer summary ──────────────────────────────────────────────────────── */

/**
 * The line that accounts for everything the board did not show.
 *
 * ⚠ THIS IS WHAT REPLACED THE LEAGUE-PICKER GRID, AND ITS LINK IS THE ONLY
 * ROUTE LEFT TO IT. `href` must always resolve — a manager with nothing urgent
 * has no other way into a league from a board that is empty by design. Render
 * this even when `hidden` is 0; the CTA is the point, the count is context.
 */
export function FooterSummary({
  hidden,
  total,
  href,
  quiet,
  emptyText = boardKitMessages.en.footAllShown,
  language = 'en',
}: {
  hidden: number
  total: number
  href: string
  /** What the hidden leagues are doing. Screen-specific; state a fact, not a mood. */
  quiet: string
  emptyText?: string
  language?: string
}) {
  const m = messagesFor(boardKitMessages, language)
  return (
    <div className="af-bd-foot">
      <p className="af-bd-foot-text">
        {hidden > 0
          ? m.footMore(hidden.toLocaleString(getAppIntlLocale()), hidden, quiet)
          : emptyText === boardKitMessages.en.footAllShown
            ? m.footAllShown
            : emptyText}
      </p>
      <Link className="af-bd-foot-cta" href={href}>
        {m.footViewAll(total.toLocaleString(getAppIntlLocale()), total)} &rarr;
      </Link>
    </div>
  )
}

/* ── an honest gap ───────────────────────────────────────────────────────── */

/**
 * What a board says to an account with NO leagues yet — and what to do instead (2026-09-29).
 *
 * 🛑 FOUR BOARDS DEAD-ENDED HERE. Trades, Waivers and Draft HQ (bottom-bar tabs) and Week each
 * printed one sentence ("No team of yours is claimed…", "No draft to show yet.", "You are not
 * projected ahead in any league") and stopped — the first thing a new user or an App Store
 * reviewer sees, with no way forward. My Team already linked to the importer; every board now
 * does, and offers the two tools that work without a league at all.
 *
 * `what` is this board's own sentence: what fills it in once a league is connected.
 */
export const NO_LEAGUE_ACTIONS = [
  { href: '/import', label: 'Connect a league', primary: true },
  { href: '/mock-draft', label: 'Try a mock draft', primary: false },
  { href: '/trade-evaluator', label: 'Grade a trade', primary: false },
] as const

export function NoLeaguesYet({ what, language = 'en' }: { what: string; language?: string }) {
  const m = messagesFor(boardKitMessages, language)
  return (
    <section className="af-bd-noleagues" data-testid="board-no-leagues" aria-label={m.noLeaguesAria}>
      <p className="af-bd-noleagues-lead">
        <strong>{m.noLeaguesLead}</strong> {what}
      </p>
      <div className="af-bd-noleagues-actions">
        {NO_LEAGUE_ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className={a.primary ? 'af-btn' : 'af-btn af-btn--ghost'}>
            {m.noLeagueAction(a.label)}
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ── league crest ────────────────────────────────────────────────────────── */

export type CrestSize = 'md' | 'sm' | 'xs'

const CREST_PX: Record<CrestSize, number> = { md: 36, sm: 28, xs: 22 }

/**
 * A league's artwork, or the monogram that is the real fallback for not having
 * any.
 *
 * ⚠ `imageUrl` MUST ALREADY BE A URL. Sleeper stores an avatar *id*, not a
 * link; `imageOf()` in lib/core-app/dash34.ts expands it. Passing the raw
 * column renders a broken image on roughly half the account's leagues — which
 * is exactly what shipped before that helper existed.
 *
 * ⚠ AND THE MONOGRAM IS NOT A DEGRADED STATE. 67 of 115 production leagues have
 * no avatar on the platform either. A tinted monogram is the correct rendering
 * of that fact, not a placeholder waiting to be replaced.
 */
export function LeagueCrest({
  imageUrl,
  mark,
  name,
  platform,
  size = 'md',
}: {
  imageUrl?: string | null
  /** Pre-computed mark, when the loader already has one. Else derived from `name`. */
  mark?: string | null
  name?: string | null
  platform?: string | null
  size?: CrestSize
}) {
  const px = CREST_PX[size]
  const cls = size === 'md' ? 'af-bd-crest' : `af-bd-crest af-bd-crest--${size}`

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={cls} src={imageUrl} alt="" width={px} height={px} loading="lazy" />
    )
  }
  return (
    <span
      className={`${cls} af-bd-crest--none`}
      data-platform={platformKey(platform)}
      aria-hidden
    >
      {mark ?? leagueMark(name)}
    </span>
  )
}

/* ── player headshot ─────────────────────────────────────────────────────── */

/**
 * A player's face, with his club crest on the shoulder.
 *
 * ⚠ BOTH IMAGES FAIL TO NOTHING, SEPARATELY. `imageUrl` is null for a large
 * share of `SportsPlayer` rows and `teamLogoUrl()` returns null for anyone the
 * team registry does not know (free agents, retirees, stray vendor codes) —
 * that null is deliberate and documented in lib/core-app/teamLogo.ts. Neither
 * absence is an error and neither may render a broken glyph beside a real name.
 */
export { PlayerFace } from './PlayerFace'

/* ── row atoms ───────────────────────────────────────────────────────────── */

export type Sev = 'bad' | 'warn' | 'good' | 'info'

/** A labelled figure — `AF PROJ` over `15.8`. */
export function StatPair({
  k,
  v,
  sev,
}: {
  k: string
  v: string
  sev?: 'good' | 'warn' | 'bad' | 'accent'
}) {
  return (
    <span className="af-bd-kv">
      <span className="af-bd-k">{k}</span>
      <span className="af-bd-v" data-sev={sev}>
        {v}
      </span>
    </span>
  )
}

/** `01`, `02`, … — the handoff pads to two so the column does not jitter. */
export function rankLabel(i: number): string {
  return String(i + 1).padStart(2, '0')
}

/* ── two-column stacking ─────────────────────────────────────────────────── */

/**
 * Are the two columns too unequal to sit side by side?
 *
 * ⚠ THIS USED TO ASK "IS ONE SIDE EMPTY", AND EMPTY IS THE RARE CASE. Observed
 * on a real 66-league portfolio: 1 needing a change against 5 set, which left
 * roughly 160px of blank column under the single row — four rows of nothing
 * beside five rows of content. That is the STEADY state, not an edge case: most
 * weeks a manager has one or two lineups to fix and dozens already set, so the
 * balanced layout the two-column grid assumes is the one that almost never
 * happens.
 *
 * Three rows of difference is where the shorter column stops reading as a list
 * and starts reading as a panel that failed to load. Below that the gap is small
 * enough that side-by-side still compares better than stacking.
 *
 * ⚠ IT LIVES HERE, NOT ON ONE BOARD, so the boards that share a two-column
 * layout cannot drift into disagreeing about when to stack. It was exported
 * from MyTeamBoard until that screen became a single ranked list.
 */
export function columnsTooUneven(a: number, b: number): boolean {
  return Math.abs(a - b) >= 3
}
