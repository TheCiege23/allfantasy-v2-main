'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import type { WeekBoard, WeekMatchup } from '@/lib/core-app/weekBoard'
import type { WeeklyCalendar } from '@/lib/core-app/weeklyCalendar'
import { weeklyCalendarTitle } from '@/lib/core-app/weeklyCalendar'
import {
  closeGames,
  gameAction,
  groupKickoffs,
  lineupsToFix,
  otherDeadlines,
  rankSurvival,
  summarizeWeek,
  survivalStatus,
  type GameAction,
  type LineupFact,
} from '@/lib/core-app/weekGuide'
import { weekGuideMessages } from '@/lib/core-app/messages/weekGuide'
import { WeekDateRange } from '@/components/core-app/WeekDateRange'
// The card and button primitives (af3a-card, af3a-btn) live with the home dashboard's styles; load them
// here rather than relying on another screen's import having put them on the page.
import '@/components/core-app/af-dash-3a.css'
import '@/components/core-app/home/af-home-guide.css'
import '@/components/core-app/week/af-week-guide.css'

/**
 * The top of /core/week, across every league (2026-11-13). It replaced the "Blueprint" paragraph and the
 * second "Your week" header that stacked under it: one headline, the games close enough to act on, the
 * survival leagues in plain words, and kickoffs grouped by time. The scoreboard below it is the existing
 * WeekBoard, and the Blueprint's tools are kept behind one disclosure under that.
 *
 * Every number is read from the WeekBoard and WeeklyCalendar the page already loads (weekGuide.ts).
 */

type Text = (typeof weekGuideMessages)['en']

const CLOSE_LIMIT = 5
/** Every survival league: the scoreboard below no longer repeats them (WeekBoard `embedded`). */

/** Weekday and clock time in the reader's own zone — only after hydration, as the rest of /core does. */
function useLocalWhen(iso: string | null): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (!iso) return
    try {
      setText(
        new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
      )
    } catch {
      setText(null)
    }
  }, [iso])
  return text
}

function LocalWhen({ iso }: { iso: string }) {
  const text = useLocalWhen(iso)
  // The server's paint is the UTC instant, trimmed; the reader's own time replaces it after hydration.
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text ?? `${iso.slice(5, 10)} ${iso.slice(11, 16)} UTC`}
    </time>
  )
}

function gameStatus(m: WeekMatchup, t: Text): string {
  if (m.live) {
    const pts = Math.abs(m.live.margin).toFixed(1)
    return m.live.margin > 0 ? t.aheadSoFar(pts) : m.live.margin < 0 ? t.behindSoFar(pts) : t.tiedSoFar
  }
  if (m.projection) return t.projected(m.projection.you.toFixed(1), m.projection.them.toFixed(1))
  return ''
}

type Chip = { key: string; value: string; label: string; tone: 'warn' | 'bad' | 'plain'; href: string | null }

function Headline({
  board,
  totalLeagues,
  facts,
  t,
}: {
  board: WeekBoard
  totalLeagues: number
  facts: ReadonlyMap<string, LineupFact>
  t: Text
}) {
  const s = summarizeWeek(board)
  const kickoff = useLocalWhen(s.firstKickoffAt)
  const fix = lineupsToFix(facts)
  /*
   * Every chip that names something you can act on links there (2026-11-13, owner: users should know
   * exactly what to do). "No game this week" and "0 lineups to fix" have nowhere to go, so they stay
   * plain text — /core/my-team with no league redirects back to this page.
   */
  const chips: Chip[] = [
    ...(facts.size > 0
      ? [{ key: 'lineups', value: String(fix.count), label: t.chipLineups, tone: (fix.count > 0 ? 'bad' : 'plain') as Chip['tone'], href: fix.firstHref }]
      : []),
    { key: 'close', value: String(s.close), label: t.chipClose, tone: s.close > 0 ? 'warn' : 'plain', href: '#af-wg-close' },
    ...(s.survival > 0
      ? [{ key: 'survival', value: String(s.survivalAtRisk), label: t.chipSurvival, tone: (s.survivalAtRisk > 0 ? 'bad' : 'plain') as Chip['tone'], href: '#af-wg-survival' }]
      : []),
    ...(s.firstKickoffAt ? [{ key: 'kickoff', value: kickoff ?? '—', label: t.chipKickoff, tone: 'plain' as const, href: '#af-wg-kick' }] : []),
    // With the lineups chip present, "no game" is the least useful of five; drop it so the row stays four.
    ...(facts.size > 0 ? [] : [{ key: 'nogame', value: String(s.noGame), label: t.chipNoGame, tone: 'plain' as const, href: null }]),
  ]
  return (
    <section className="af-hg-head af-wg-head" aria-labelledby="af-wg-title">
      <div className="af-hg-head-top">
        <p className="af-hg-eyebrow">
          {t.eyebrow(board.week, totalLeagues)} · <WeekDateRange />
        </p>
      </div>
      <h1 id="af-wg-title" className="af-hg-title">
        {s.winning + s.losing + s.close > 0 ? t.headline(s.winning, s.losing, s.close) : t.noGamesYet}
      </h1>
      <p className="af-hg-intro">{t.intro}</p>
      <ul className="af-hg-chips">
        {chips.map((c) => {
          const tone = c.tone === 'bad' ? 'warn' : c.tone === 'warn' ? 'info' : 'ok'
          const body = (
            <>
              <b suppressHydrationWarning>{c.value}</b>
              <span>{c.label}</span>
            </>
          )
          return (
            <li key={c.key}>
              {c.href ? (
                <Link className="af-hg-chip" data-tone={tone} href={c.href}>
                  {body}
                </Link>
              ) : (
                <span className="af-hg-chip af-wg-chip" data-tone={tone}>
                  {body}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The button a close game gets: the one move worth making, with a deadline when one is known. */
function ActionButton({ action, t }: { action: GameAction; t: Text }) {
  const label =
    action.kind === 'fill'
      ? t.actFill(action.count)
      : action.kind === 'swap'
        ? t.actSwap(action.count)
        : action.kind === 'check'
          ? t.actCheck(action.count)
          : action.kind === 'set'
            ? t.actSet
            : action.kind === 'auto'
              ? t.actAuto
              : action.kind === 'locked'
                ? t.actLocked
                : t.actUnknown
  const urgent = action.kind === 'fill' || action.kind === 'swap'
  return (
    <Link className={`af3a-btn${urgent ? ' af3a-btn-accent' : ''}`} href={action.href}>
      {label}
    </Link>
  )
}

/** The reason under a close game, said once: why the button says what it says, and by when. */
function ActionWhy({ action, t }: { action: GameAction; t: Text }) {
  const lockAt = action.kind === 'fill' || action.kind === 'swap' || action.kind === 'check' ? action.lockAt : null
  const why =
    action.kind === 'swap'
      ? t.actSwapWhy
      : action.kind === 'set'
        ? t.actSetWhy
        : action.kind === 'auto'
          ? t.actAutoWhy
          : action.kind === 'locked'
            ? t.actLockedWhy
            : null
  if (!why && !lockAt) return null
  return (
    <p className="af-wg-row-sub af-wg-why">
      {why}
      {why && lockAt ? ' · ' : ''}
      {lockAt ? <BeforeWhen iso={lockAt} t={t} /> : null}
    </p>
  )
}

function BeforeWhen({ iso, t }: { iso: string; t: Text }) {
  const text = useLocalWhen(iso)
  return text ? <span suppressHydrationWarning>{t.before(text)}</span> : null
}

function CloseGames({
  board,
  allHref,
  facts,
  t,
}: {
  board: WeekBoard
  allHref: string
  facts: ReadonlyMap<string, LineupFact>
  t: Text
}) {
  const games = closeGames(board)
  const shown = games.slice(0, CLOSE_LIMIT)
  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-wg-close">
      <header className="af-hg-cardhead">
        <h2 id="af-wg-close">{t.closeTitle}</h2>
        <span>{t.closeSub}</span>
      </header>
      {shown.length === 0 ? (
        <p className="af-hg-empty">{t.closeNone}</p>
      ) : (
        <ul className="af-wg-rows">
          {shown.map((m) => {
            const action = gameAction(facts.get(m.leagueId), m.href)
            return (
              <li key={m.leagueId}>
                <div className="af-wg-row-main">
                  <p className="af-wg-row-title">
                    <Link className="af-wg-row-name" href={m.href}>
                      {m.leagueName}
                    </Link>
                    {m.opponent.name ? <span> · {t.vs(m.opponent.name)}</span> : null}
                  </p>
                  <p className="af-wg-row-sub">
                    {gameStatus(m, t)}
                    {/* The win chance is a pre-game number; once points are on the board the score is the fact. */}
                    {m.projection && !m.live ? ` · ${t.toWin(Math.round(m.projection.winProbability * 100))}` : ''}
                  </p>
                  <ActionWhy action={action} t={t} />
                </div>
                <ActionButton action={action} t={t} />
              </li>
            )
          })}
        </ul>
      )}
      {games.length > shown.length ? (
        <Link className="af-hg-more" href={allHref}>
          {t.closeMore(games.length - shown.length)} →
        </Link>
      ) : null}
      <p className="af-decision-why af-hg-why">
        <b>{t.why}</b> {t.closeTeach}
      </p>
    </section>
  )
}

function Survival({ board, t }: { board: WeekBoard; t: Text }) {
  if (board.eliminationWeeks.length === 0) return null
  const ranked = rankSurvival(board.eliminationWeeks)
  const shown = ranked
  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-wg-survival">
      <header className="af-hg-cardhead">
        <h2 id="af-wg-survival">{t.survivalTitle}</h2>
        <span>{t.survivalSub}</span>
      </header>
      <ul className="af-wg-rows">
        {shown.map((e) => {
          const s = survivalStatus(e)
          return (
            <li key={e.leagueId}>
              <Link className="af-wg-row-link" href={e.href}>
                <span className="af-wg-row-title">{e.leagueName}</span>
                <span className="af-wg-status" data-tone={s.kind === 'lowest' ? 'bad' : s.kind === 'above' ? 'good' : 'plain'}>
                  {s.kind === 'lowest'
                    ? t.survivalLowest
                    : s.kind === 'above'
                      ? t.survivalAbove(s.points.toFixed(1))
                      : t.survivalNotStarted}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="af-decision-why af-hg-why">
        <b>{t.why}</b> {t.survivalTeach}
      </p>
    </section>
  )
}

function Kickoffs({ calendar, t }: { calendar: WeeklyCalendar | null; t: Text }) {
  const { groups, more } = groupKickoffs(calendar)
  const deadlines = otherDeadlines(calendar)
  return (
    <section className="af3a-card af-hg-card" aria-labelledby="af-wg-kick">
      <header className="af-hg-cardhead">
        <h2 id="af-wg-kick">{t.kickTitle}</h2>
        <span>{t.kickSub}</span>
      </header>
      {groups.length === 0 ? (
        <p className="af-hg-empty">{t.kickNone}</p>
      ) : (
        <ul className="af-wg-rows">
          {groups.map((g) => (
            <li key={g.at}>
              <div className="af-wg-row-main">
                <p className="af-wg-row-title">
                  <LocalWhen iso={g.at} />
                  <span> · {t.kickLeagues(g.leagues.length)}</span>
                </p>
                <p className="af-wg-row-sub">
                  {g.leagues
                    .slice(0, 3)
                    .map((l) => l.leagueName)
                    .join(', ')}
                  {g.leagues.length > 3 ? ` +${g.leagues.length - 3}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? <p className="af-hg-note">{t.kickMore(more)}</p> : null}
      {deadlines.length > 0 ? (
        <>
          <p className="af-hg-label">{t.otherDeadlines}</p>
          <ul className="af-wg-rows">
            {deadlines.map((d) => (
              <li key={d.id}>
                <Link className="af-wg-row-link" href={d.href}>
                  <span className="af-wg-row-title">
                    {weeklyCalendarTitle(d)} · {d.leagueName}
                  </span>
                  <span className="af-wg-status" data-tone="plain">
                    <LocalWhen iso={d.at} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="af-decision-why af-hg-why">
        <b>{t.why}</b> {t.kickTeach}
      </p>
    </section>
  )
}

export function WeekGuide({
  board,
  calendar,
  totalLeagues,
  allHref,
  isCommissioner,
  lineups = [],
}: {
  board: WeekBoard
  /** The 7-day calendar the Blueprint already builds; null when it could not be read. */
  calendar: WeeklyCalendar | null
  totalLeagues: number
  /** The full scoreboard, every league — `/core/week?all=1`. */
  allHref: string
  /** Runs at least one league in view — draws the "Leagues you run" row. */
  isCommissioner: boolean
  /**
   * Each league's lineup facts (`lineupFacts(myTeamPulse)`, weekGuide.ts), so every close game can say
   * the one move to make. Empty when the lineups could not be read: buttons then fall back to "Check lineup".
   */
  lineups?: LineupFact[]
}) {
  const t = useMessages(weekGuideMessages)
  const facts = new Map(lineups.map((f) => [f.leagueId, f]))
  return (
    <div className="af-wg">
      <Headline board={board} totalLeagues={totalLeagues} facts={facts} t={t} />
      <CloseGames board={board} allHref={allHref} facts={facts} t={t} />
      <div className="af-wg-pair">
        <Survival board={board} t={t} />
        <Kickoffs calendar={calendar} t={t} />
      </div>
      {isCommissioner ? (
        <section className="af3a-card af-hg-card af-wg-run" aria-labelledby="af-wg-run">
          <header className="af-hg-cardhead">
            <h2 id="af-wg-run">{t.runTitle}</h2>
            <span>{t.runBody}</span>
          </header>
          <Link className="af-hg-more" href="/core/commissioner">
            {t.runOpen} →
          </Link>
        </section>
      ) : null}
    </div>
  )
}

/**
 * The Blueprint's tools behind one closed row, under the scoreboard. Its children are the compact
 * WeeklyBlueprint; this wrapper only exists so the summary is said in the reader's language.
 */
export function WeekToolsDisclosure({ children }: { children: ReactNode }) {
  const t = useMessages(weekGuideMessages)
  return (
    <details className="af-wg-tools">
      <summary>
        <b>{t.toolsTitle}</b>
        <span>{t.toolsSub}</span>
      </summary>
      {children}
    </details>
  )
}

export default WeekGuide
