'use client'

import { useEffect, useRef, useState } from 'react'
import { ProjectionFactorLine } from '@/components/projections/ProjectionFactorLine'

import type {
  PlayerCardComp,
  PlayerCardDailySchedule,
  PlayerCardData,
  PlayerCardNews,
  PlayerCardTrade,
  PlayerCardWeek,
} from '@/lib/core-app/playerCard'
import type { PlayerCardNav, PlayerCardRef } from './PlayerCardProvider'
import { PC_PANEL_ATTR, startsInHorizontalScroller } from './playerCardSiblings'
import { useOverlayContainment } from '../useOverlayContainment'
import PlayerHighlights from './PlayerHighlights'
import PlayerRecentClips from '../highlights/PlayerRecentClips'
import { CoreDepthLock, FreeUntilNote } from '../CoreDepthLock'
import { scheduleProjectionNote, scheduleRowValue } from '@/lib/core-app/scheduleProjectionNote'
import { gameDayAndClock } from '@/lib/core-app/kickoffLabel'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { PROJECTION_PROVIDER_LABEL } from '@/lib/core-app/projectionProvider'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { lockSubjectText } from '@/lib/core-app/coreDepthLockCopy'
import {
  cardAgo,
  injuryStatusText,
  insightText,
  pickLabelText,
  playerCardCopy,
  playerCardReasonText,
  withheldGradeText,
} from '@/lib/core-app/playerCardCopy'
import { FallbackImg } from '@/components/core-app/FallbackImg'
import { TeamLogo } from '@/app/components/TeamLogo'
import { isNoTeam } from '@/lib/players/teamLogos'
import { PlayerValueHistoryChart } from './PlayerValueHistoryChart'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import GamesCountWeekPanel from './GamesCountWeekPanel'
import { DynastyMarkerChips } from '@/components/core-app/screens/DynastyRosterMarkers'
import { isGamesCountSport } from '@/lib/redraft/gamesCount'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'
import type { PlayerCardMore } from '@/lib/core-app/playerCardMore'
import { playerCardLayoutCopy, type CardTabId } from '@/lib/core-app/playerCardLayoutCopy'
import { playerCardRankChips, playerCardTabs } from '@/lib/core-app/playerCardTabs'
import { playerCardActions } from '@/lib/core-app/playerCardActions'
import PlayerGameLogTable, {
  fetchPlayerGameLog,
  gameLogSupported,
  type PlayerGameLogPayload,
} from '@/components/player-game-log/PlayerGameLogTable'

/**
 * STATE 6 / STATE 7 of the design handoff, in one component.
 *
 * ⚠ ONE COMPONENT FOR BOTH FLAVOURS, BECAUSE THE DESIGN IS ONE CARD. The handoff
 * draws "universal" and "league" as two screens, but they are the same shell
 * with three swaps: the header's back-link, the stat row, and one column. Two
 * components would mean fixing every layout bug twice.
 *
 * ⚠ DESKTOP AND MOBILE ARE THE SAME MARKUP, SWITCHED IN CSS. The design shows a
 * right-hand slide-in on desktop and a full-screen sheet on mobile; those differ
 * only in how the panel is anchored and sized, so `af-player-card.css` does it
 * with one media query rather than this file branching on a width it would have
 * to measure (and would get wrong on first paint).
 *
 * ⚠ NOTHING HERE INVENTS A NUMBER, AND NOTHING PRINTS WHY ONE IS MISSING (owner, 2026-11-26). The
 * header follows Sleeper's: a big headshot on a club-tinted band, the owner, name, bio, rank chips and
 * the roster actions. Below it, tabs (lib/core-app/playerCardTabs.ts) show only what this sport and
 * player actually have; a section with no data loses its tab rather than explaining itself. News sits
 * in a side column on a wide screen and is a tab on a phone. Drop opens a confirm sheet that hands off
 * to the league's Players & waivers screen (lib/core-app/playerCardActions.ts) — no new roster rules.
 *
 * SPANISH (2026-10-06): the card's own words come from lib/core-app/playerCardCopy.ts in the
 * reader's language (`useOptionalLanguage`, English on the server and the first client render), and
 * the loader's reasons and derived insight are translated at render there too. Provider text —
 * names, news, the injury feed's note — stays as written.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

function ScheduleRows({ weeks, language }: { weeks: PlayerCardWeek[]; language: string }) {
  const c = playerCardCopy(language)
  return (
    <>
      {weeks.map((w) => {
        // A later week says WHY it has no number — "not published yet" is a different claim from "—".
        const value = scheduleRowValue(w, language)
        return (
          <div key={w.week} className={`af-pc-row${w.bye ? ' af-pc-row--muted' : ''}`}>
            <span className="af-pc-row-k">{c.weekRow(w.week, w.bye, w.home, w.opponent)}</span>
            {/* The week AllFantasy's engine published: both projections, labelled. */}
            {w.afProjection != null ? (
              <span className="af-pc-row-v af-num" title={c.projTitle(PROJECTION_PROVIDER_LABEL)}>
                <span className="af-pc-proj-src">{PROJECTION_PROVIDER_LABEL}</span> {w.projection != null ? w.projection.toFixed(1) : '—'}
                {' · '}
                <span className="af-pc-proj-src af-pc-proj-src--af">AF</span> {w.afProjection.toFixed(1)}
              </span>
            ) : (
              <span className={`af-pc-row-v${value.muted ? ' af-pc-faint' : ' af-num'}`} title={value.title}>
                {value.text}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * A daily sport's next games: "Thu 11/12 · vs BOS" and the clock, on the US Eastern clock every /core
 * screen uses, the day in the reader's language. Then the week's count when the loader could tell it.
 */
function DailyGameRows({ schedule, language }: { schedule: PlayerCardDailySchedule; language: string }) {
  const c = playerCardCopy(language)
  return (
    <>
      {schedule.games.map((g) => {
        const when = gameDayAndClock(g.startTime)
        return (
          <div key={`${g.startTime}-${g.opponent}`} className="af-pc-row" data-testid="af-pc-daily-game">
            <span className="af-pc-row-k">{c.gameRow(when ? kickoffText(when.day, language) : '—', g.home, g.opponent)}</span>
            <span className="af-pc-row-v af-num">{when?.time ?? ''}</span>
          </div>
        )
      })}
      {schedule.gamesThisWeek != null ? <p className="af-pc-basis">{c.gamesThisWeek(schedule.gamesThisWeek)}</p> : null}
    </>
  )
}

function TradeRows({ trades, subject, language }: { trades: PlayerCardTrade[]; subject: string; language: string }) {
  const c = playerCardCopy(language)
  return (
    <>
      {trades.map((t) => {
        /*
         * ⚠ DROP THE SUBJECT BY NAME, NOT BY POSITION. This first read
         * `acquired.slice(1)`, assuming the player whose card this is sits at
         * index 0 of his own side. He does not — the provider's array order is
         * whatever the transaction carried — so a real three-player trade
         * rendered "Moved with Jahmyr Gibbs" on Jahmyr Gibbs's own card.
         */
        const got = t.acquired.filter((n) => n && n !== subject)
        const sent = [...t.sent.filter(Boolean), ...t.picks.map((pick) => pickLabelText(pick, language))]
        return (
          <div key={t.transactionId} className="af-pc-trade">
            <div className="af-pc-trade-h">
              <span className={`af-pc-plat af-pc-plat--${t.platform.toLowerCase()}`}>{t.platform.toUpperCase()}</span>
              {t.leagueName ? <span className="af-pc-trade-lg"> · {t.leagueName}</span> : null}
            </div>
            <div className="af-pc-trade-b">
              {sent.length > 0 ? c.cost(sent.join(' + ')) : c.packageNotRecorded}
              {t.tradeDate ? <span className="af-pc-faint"> · {cardAgo(t.tradeDate, language)}</span> : null}
            </div>
            {got.length > 0 ? (
              <div className="af-pc-trade-b af-pc-faint">{c.movedWith(got.join(', '))}</div>
            ) : null}
            {/*
              THE grade (2026-09-27): the side that got him, then the side that paid — the /core
              Trades letter for the same trade. A withheld grade says why, with no letter.

              WHEN the letter was taken is `gradeMoment`'s phrase, never a bare "today": a completed
              trade's grade is its FROZEN original, priced at the time of the trade or first graded.
            */}
            {t.grade?.graded ? (
              <div className="af-pc-trade-grade" aria-label={c.gradeAria}>
                <span className="af-pc-trade-letter" data-letter={t.grade.acquirerLetter}>
                  {c.gotHim} <b>{t.grade.acquirerLetter}</b>
                </span>
                <span className="af-pc-trade-letter" data-letter={t.grade.senderLetter}>
                  {c.paid} <b>{t.grade.senderLetter}</b>
                </span>
                <span className="af-pc-faint">
                  {c.gradeLine(t.grade.got.toLocaleString(getAppIntlLocale()), t.grade.gave.toLocaleString(getAppIntlLocale()), gradeMoment(t.grade, language))}
                </span>
              </div>
            ) : t.grade && !t.grade.graded ? (
              <div className="af-pc-trade-b af-pc-faint">{c.notGraded(withheldGradeText(t.grade.withheld, language))}</div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function NewsRows({ items, language }: { items: PlayerCardNews[]; language: string }) {
  return (
    <>
      {items.map((n, i) => (
        <div key={`${n.title}-${i}`} className="af-pc-news">
          {n.url ? (
            <a className="af-pc-news-t" href={n.url} target="_blank" rel="noreferrer noopener">
              {n.title}
            </a>
          ) : (
            <span className="af-pc-news-t">{n.title}</span>
          )}
          <span className="af-pc-faint">
            {' '}
            — {n.source}
            {cardAgo(n.publishedAt, language) ? ` · ${cardAgo(n.publishedAt, language)}` : ''}
          </span>
        </div>
      ))}
    </>
  )
}

/** Football's fantasy weeks; every other sport's game log is keyed by date. */
const isWeeklySport = (sport: string) => ['NFL', 'NCAAF'].includes(sport.toUpperCase())

/** One number with its label, used in the Outlook tab. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="af-pc-stat">
      <div className="af-pc-stat-l">{label}</div>
      <div className="af-pc-stat-v af-num">{value}</div>
      {sub ? <div className="af-pc-stat-s">{sub}</div> : null}
    </div>
  )
}

/** A stable, dark band colour per club: the header's tint behind the crest. */
function bandColour(sport: string, team: string | null): string {
  const key = `${sport}:${(team ?? '').toUpperCase()}`
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 45% 24%)`
}

/**
 * Sleeper's "Confirm Transaction" sheet for a Drop. It makes no move itself: Confirm hands off to the
 * league's Players & waivers screen with him picked as the drop (lib/core-app/playerCardActions.ts),
 * where the add or claim that goes with it runs through the existing routes and their rules.
 */
export function DropConfirmSheet({
  name,
  position,
  team,
  sport,
  image,
  href,
  language,
  onCancel,
}: {
  name: string
  position: string | null
  team: string | null
  sport: string
  image: string | null
  href: string
  language: string
  onCancel: () => void
}) {
  const l = playerCardLayoutCopy(language)
  const crest = team && !isNoTeam(team) ? teamLogoUrl(sport, team) : null
  return (
    <div className="af-pc-confirm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="af-pc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="af-pc-confirm-t" data-testid="player-card-drop-confirm">
        <div className="af-pc-confirm-h">
          <div>
            <h3 id="af-pc-confirm-t">{l.confirmTitle}</h3>
            <p>{l.confirmSub}</p>
          </div>
          <button type="button" className="af-pc-x" onClick={onCancel} aria-label={l.cancel}>
            ✕
          </button>
        </div>
        <div className="af-pc-confirm-box">
          <div className="af-pc-confirm-kind">{l.confirmDrop}</div>
          <div className="af-pc-confirm-tag">{l.dropTag}</div>
          <div className="af-pc-confirm-row">
            <span className="af-pc-confirm-face" aria-hidden>
              {image ? (
                <FallbackImg src={image} alt="" width={44} height={44} fallback={<span>{initials(name)}</span>} />
              ) : (
                <span>{initials(name)}</span>
              )}
              {crest ? <FallbackImg className="af-pc-confirm-crest" src={crest} alt="" width={18} height={18} fallback={null} /> : null}
            </span>
            <span>
              <b>{name}</b>
              <span className="af-pc-faint">{[position?.toUpperCase(), team].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          <p className="af-pc-confirm-next">{l.confirmNext}</p>
        </div>
        <div className="af-pc-confirm-a">
          <button type="button" className="af-pc-btn af-pc-btn--ghost" onClick={onCancel}>
            {l.cancel}
          </button>
          <a className="af-pc-btn af-pc-btn--go" href={href} data-testid="player-card-drop-go">
            {l.confirm}
          </a>
        </div>
      </div>
    </div>
  )
}

export default function PlayerCardSheet({
  subject,
  data,
  status,
  onClose,
  onOpen,
  more = null,
  nav = null,
}: {
  subject: PlayerCardRef
  data: PlayerCardData | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  onClose: () => void
  onOpen: (ref: PlayerCardRef) => void
  /** Game log, Career and Depth chart (PlayerCardProvider reads them after the card). Null hides those tabs. */
  more?: PlayerCardMore | null
  /** The list the card was opened from — previous / next player. Null: a lone card, no arrows. */
  nav?: PlayerCardNav | null
}) {
  const { language } = useOptionalLanguage()
  const c = playerCardCopy(language)
  const l = playerCardLayoutCopy(language)
  const reason = (text: string) => playerCardReasonText(text, language)
  const ago = (iso: string | null) => cardAgo(iso, language)
  const afProjection = data?.afLeagueProjection
  const projectionUnit = afProjection?.unit === 'category score' ? c.afCategory : c.afPoints
  const projectionNumber = (points: number) => points.toLocaleString(getAppIntlLocale(), { maximumFractionDigits: 1 })
  const [insightOpen, setInsightOpen] = useState(false)
  /* The ☆'s optimistic value; null means "defer to the payload". */
  const [watchOverride, setWatchOverride] = useState<boolean | null>(null)
  /* The trade-block toggle's optimistic value, the same way; plus a refusal to show. */
  const [blockOverride, setBlockOverride] = useState<boolean | null>(null)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockError, setBlockError] = useState<string | null>(null)
  const [tab, setTab] = useState<CardTabId | null>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  /*
   * Focus lands inside the sheet AND stays there, the page behind stops scrolling, Escape closes,
   * and focus returns to the row that opened it (the shared, reference-counted hook).
   */
  useOverlayContainment({
    active: true,
    containerRef: panelRef,
    onClose: confirmDrop ? () => setConfirmDrop(false) : onClose,
    initialFocusRef: closeRef,
  })

  /*
   * Swiping keeps the TAB: flipping through a roster on Game log is comparing players, and snapping
   * back to the first tab on every step would defeat it. Everything else is the player's own.
   */
  const keepTabRef = useRef(false)
  const step = (dir: -1 | 1) => {
    if (!nav || confirmDrop) return
    if (dir === -1 ? !nav.prev : !nav.next) return
    keepTabRef.current = true
    nav.go(dir)
  }

  // A comp opened from inside the card must not inherit the previous player's tab, star or sheet.
  useEffect(() => {
    setInsightOpen(false)
    setWatchOverride(null)
    setBlockOverride(null)
    setBlockError(null)
    if (!keepTabRef.current) setTab(null)
    keepTabRef.current = false
    setConfirmDrop(false)
  }, [subject.externalId, subject.sleeperId])

  /*
   * A horizontal swipe on the card moves to the previous / next player. Not when it starts on
   * something that scrolls sideways (the game log table), not a mostly-vertical drag (reading the
   * card), and not a slow drag.
   */
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchRef.current =
      nav && e.touches.length === 1 && t && !startsInHorizontalScroller(e.target, panelRef.current)
        ? { x: t.clientX, y: t.clientY, t: Date.now() }
        : null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current
    touchRef.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - start.t > 800) return
    step(dx < 0 ? 1 : -1)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!nav || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const target = e.target as HTMLElement
    // Arrow keys belong to whatever is editing or choosing: a field, a select, the tab strip.
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]')) return
    e.preventDefault()
    step(e.key === 'ArrowRight' ? 1 : -1)
  }

  const p = data?.player
  const name = p?.name ?? subject.name
  const position = p?.position ?? subject.position ?? null
  const team = p?.team ?? subject.team ?? null
  const image = p?.imageUrl ?? subject.imageUrl ?? null
  const sport = String(p?.sport ?? subject.sport ?? 'NFL')
  const league = data?.league ?? null
  const market = data?.market
  const bio = data?.bio
  const depth = data?.depth ?? null
  const depthLocked = depth?.unlocked === false
  const insight = data?.insight ? insightText(data.insight, language) : null

  /*
   * NHL / NBA / NCAAB / MLB / soccer get the full per-game box log (final score, time on ice, the
   * whole line, Last 5/10 averages) from /api/players/game-log. It is keyed by the Rolling Insights
   * id or the Sleeper id, so it needs one of those; `more.gameLog` (fantasy points only) stays the
   * football view. The daily ingest leaves `fantasyPoints` at 0 = NOT SCORED, so that table cannot
   * serve these sports.
   */
  const boxLogKey =
    p && gameLogSupported(p.sport) && (p.source === 'rolling_insights' || p.sleeperId)
      ? { externalId: p.externalId, source: p.source ?? null, sleeperId: p.sleeperId }
      : null
  const boxLogId = boxLogKey && p ? `${p.sport}|${boxLogKey.source ?? ''}|${boxLogKey.externalId}|${boxLogKey.sleeperId ?? ''}` : null
  // Fetched up front, like `more`: a tab is hidden, never empty, so the card must know there are games.
  const [boxLog, setBoxLog] = useState<{ id: string; log: PlayerGameLogPayload | null } | null>(null)
  useEffect(() => {
    if (!boxLogId || !boxLogKey || !p) return
    let alive = true
    fetchPlayerGameLog(p.sport, boxLogKey).then((log) => {
      if (alive) setBoxLog({ id: boxLogId, log })
    })
    return () => {
      alive = false
    }
    // Keyed on the id string; `boxLogKey` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxLogId])
  const boxLogData = boxLog && boxLog.id === boxLogId && (boxLog.log?.groups.length ?? 0) > 0 ? boxLog.log : null
  const tabs = playerCardTabs(data, more, { boxScoreLog: boxLogData != null })
  const activeTab: CardTabId | null = tab && tabs.includes(tab) ? tab : (tabs.find((t) => t !== 'news') ?? tabs[0] ?? null)
  const chips = playerCardRankChips(data, l)
  const actions = playerCardActions(league, { sleeperId: p?.sleeperId ?? subject.sleeperId, externalId: p?.externalId ?? subject.externalId, name })

  /*
   * ⚠ FOLLOW FIRST, LEAGUE WATCHLIST AS THE FALLBACK (user decisions, 2026-09-14). With `follow` on
   * the payload the star is a cross-league follow on EVERY card; without it (signed out, or the
   * migration not applied) it is this league's watchlist, and only on the league flavour.
   */
  const follow = data?.follow ?? null
  const followSleeperId = p?.sleeperId ?? subject.sleeperId ?? null
  const followExternalId = p?.externalId ?? subject.externalId ?? null
  const useFollow = Boolean(follow && (followSleeperId || followExternalId))
  const watched = watchOverride ?? (useFollow ? Boolean(follow?.following) : (league?.watched ?? false))
  const watchId = p?.sleeperId ?? subject.sleeperId ?? null

  const toggleWatch = async () => {
    if (!useFollow && (!league || !watchId)) return
    const next = !watched
    // Flip first: a star that waits for a round-trip reads as a dropped click.
    setWatchOverride(next)
    try {
      const res = await fetch('/api/core/player-card/watch', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          useFollow
            ? {
                sport,
                ...(followSleeperId ? { sleeperId: followSleeperId } : {}),
                ...(followExternalId ? { externalId: followExternalId } : {}),
              }
            : { leagueId: league!.leagueId, sleeperId: watchId, sport },
        ),
      })
      // Revert on a refusal too: a 401 resolves, and a lit star over nothing saved is worse.
      if (!res?.ok) setWatchOverride(!next)
    } catch {
      setWatchOverride(!next)
    }
  }

  /* The trade block: only YOUR players, only where AllFantasy can hold the listing (the server proves both). */
  const block = league?.tradeBlock ?? null
  const onBlock = blockOverride ?? Boolean(block?.listed && block?.byYou)
  const canMarkBlock = Boolean(league?.isYours && block?.supported && watchId)

  const toggleBlock = async () => {
    if (!canMarkBlock || !league || blockBusy) return
    const next = !onBlock
    setBlockOverride(next)
    setBlockError(null)
    setBlockBusy(true)
    try {
      const res = await fetch('/api/core/player-card/watch', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId: league.leagueId, sleeperId: watchId, sport, list: 'trade-block' }),
      })
      if (!res?.ok) {
        setBlockOverride(!next)
        const body = (await res?.json?.().catch(() => null)) as { error?: unknown } | null
        setBlockError(typeof body?.error === 'string' ? reason(body.error) : c.blockSaveFailed)
      }
    } catch {
      setBlockOverride(!next)
      setBlockError(c.blockSaveFailed)
    } finally {
      setBlockBusy(false)
    }
  }

  const openComp = (comp: PlayerCardComp) => {
    onOpen({ sport: subject.sport, sleeperId: comp.sleeperId, name: comp.name, position: comp.position, leagueId: subject.leagueId })
  }

  const crest = team && !isNoTeam(team) ? teamLogoUrl(sport, team) : null

  /* The owner line above the name: who holds him here. Nothing when it is not known. */
  const ownerLine = !league
    ? null
    : league.slot === 'UNREADABLE'
      ? null
      : league.slot === 'NOT ROSTERED'
        ? c.freeAgent
        : league.isYours
          ? c.onYourRoster
          : c.ownedBy(league.owner?.ownerName ?? null)

  /* Outlook's value: the league's own value when it has one, the market's otherwise — said once. */
  const value: { label: string; value: string; sub?: string } | null = league?.boardValue?.available
    ? {
        label: c.leagueValue,
        value: Math.round(league.boardValue.data.value).toLocaleString(getAppIntlLocale()),
        sub: c.leagueValueSub(
          league.boardValue.data.perGame.toFixed(1),
          league.boardValue.data.unit,
          league.boardValue.data.gamesRemaining,
          league.boardValue.data.scheduleKnown,
        ),
      }
    : league?.price.available
      ? {
          label: c.leaguePrice,
          value: league.price.data.value.toLocaleString(getAppIntlLocale()),
          sub: c.leaguePriceSub(league.price.data.mode, league.price.data.numQbs, league.price.data.teams),
        }
      : market?.available
        ? {
            label: c.tradePrice,
            value: market.data.value.toLocaleString(getAppIntlLocale()),
            sub: market.data.delta
              ? `${market.data.delta.change >= 0 ? '+' : ''}${market.data.delta.change.toLocaleString(getAppIntlLocale())} · ${c.deltaDays(market.data.delta.days)}`
              : undefined,
          }
        : null
  const dynasty = league?.boardValue?.available && league.boardValue.data.dynastyValue != null ? league.boardValue.data : null
  // An AF trade value of 0 says nothing a reader can use; it is shown only when there is one.
  const tradeValue = afProjection ? (afProjection.dynastyTradeValue ?? afProjection.tradeValue) || null : null

  const newsBody = data ? (
    <>
      {data.news.available ? <NewsRows items={data.news.data} language={language} /> : null}
      <PlayerRecentClips player={data.player} />
      <PlayerHighlights key={`${data.player.sport}:${data.player.externalId}`} player={data.player} />
    </>
  ) : null

  return (
    <div className="af-pc-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="af-pc-panel"
        role="dialog"
        aria-modal="true"
        aria-label={c.dialogLabel(name)}
        ref={panelRef}
        data-testid="player-card"
        {...{ [PC_PANEL_ATTR]: '' }}
        onTouchStart={nav ? onTouchStart : undefined}
        onTouchEnd={nav ? onTouchEnd : undefined}
        onKeyDown={nav ? onKeyDown : undefined}
      >
        {/* bar ─────────────────────────────────────────────────── */}
        <div className="af-pc-bar">
          <button type="button" className="af-pc-back" onClick={onClose}>
            <span>{league ? `‹ ${league.leagueName}` : c.back}</span>
          </button>
          <span className="af-pc-bar-sp" />
          {nav ? (
            <div className="af-pc-nav" role="group" aria-label={l.swipeHint} data-testid="player-card-nav">
              <button
                type="button"
                className="af-pc-nav-btn"
                onClick={() => step(-1)}
                disabled={!nav.prev}
                aria-label={nav.prev ? l.prevPlayer(nav.prev.name) : undefined}
                data-testid="player-card-prev"
              >
                <span aria-hidden>‹</span>
              </button>
              <span className="af-pc-nav-pos af-num" aria-live="polite">
                {l.playerOf(nav.index + 1, nav.total)}
              </span>
              <button
                type="button"
                className="af-pc-nav-btn"
                onClick={() => step(1)}
                disabled={!nav.next}
                aria-label={nav.next ? l.nextPlayer(nav.next.name) : undefined}
                data-testid="player-card-next"
              >
                <span aria-hidden>›</span>
              </button>
            </div>
          ) : null}
          {useFollow || (league && watchId) ? (
            <button
              type="button"
              className="af-pc-star"
              onClick={toggleWatch}
              aria-pressed={watched}
              aria-label={useFollow ? (watched ? c.unfollow(name) : c.follow(name)) : watched ? c.stopWatching(name) : c.watch(name)}
              title={useFollow ? (watched ? c.followingTitle : c.followTitle) : watched ? c.watchingTitle : c.watchTitle}
            >
              <span aria-hidden>{watched ? '★' : '☆'}</span>
            </button>
          ) : null}
          <button type="button" className="af-pc-x" onClick={onClose} aria-label={c.close} ref={closeRef}>
            ✕
          </button>
        </div>

        <div className="af-pc-body">
          {/* hero ──────────────────────────────────────────────── */}
          <div className="af-pc-hero" style={{ '--af-pc-band': bandColour(sport, team) } as React.CSSProperties} data-testid="player-card-hero">
            {crest ? <FallbackImg className="af-pc-hero-mark" src={crest} alt="" width={260} height={260} fallback={null} /> : null}
            <div className="af-pc-hero-face">
              {image ? (
                <FallbackImg src={image} alt="" width={168} height={168} fallback={<span className="af-pc-face-none" aria-hidden>{initials(name)}</span>} />
              ) : (
                <span className="af-pc-face-none" aria-hidden>
                  {initials(name)}
                </span>
              )}
              {position ? (
                <span className="af-bd-pos af-pc-hero-pos" data-pos={position.toUpperCase()}>
                  {position.toUpperCase()}
                </span>
              ) : null}
            </div>
            <div className="af-pc-hero-main">
              {ownerLine ? (
                <div className="af-pc-hero-owner" data-free={league?.slot === 'NOT ROSTERED' || undefined} data-testid="player-card-owner">
                  {ownerLine}
                </div>
              ) : null}
              <div className="af-pc-hero-name">
                <h2 className="af-pc-name">{name}</h2>
                {team && !isNoTeam(team) ? (
                  <span className="af-pc-hero-club" data-testid="player-card-team-logo">
                    <TeamLogo teamAbbr={team} sport={sport} size={18} />
                    {p?.number != null ? <span className="af-num">#{p.number}</span> : <span>{team}</span>}
                  </span>
                ) : null}
                <span className="af-pc-meta">
                  <DynastyMarkerChips mark={data?.dynastyMarker} />
                </span>
              </div>
              {bio && (bio.age != null || bio.height || bio.weight || bio.yearsExp != null || bio.college) ? (
                <div className="af-pc-bio">
                  {bio.age != null ? (
                    <span className="af-pc-bio-i">
                      <span className="af-pc-label">{c.age}</span>
                      <b>{bio.age}</b>
                    </span>
                  ) : null}
                  {bio.height ? (
                    <span className="af-pc-bio-i">
                      <span className="af-pc-label">{c.height}</span>
                      <b>{bio.height}</b>
                    </span>
                  ) : null}
                  {bio.weight ? (
                    <span className="af-pc-bio-i">
                      <span className="af-pc-label">{c.weight}</span>
                      <b>{bio.weight}</b>
                    </span>
                  ) : null}
                  {/* 0 is a rookie and null is unknown — never collapse them. */}
                  {bio.yearsExp != null ? (
                    <span className="af-pc-bio-i">
                      <span className="af-pc-label">{c.experience}</span>
                      <b>{bio.yearsExp === 0 ? c.rookie : bio.yearsExp}</b>
                    </span>
                  ) : null}
                  {bio.college ? (
                    <span className="af-pc-bio-i">
                      <span className="af-pc-label">{c.college}</span>
                      <b>{bio.college}</b>
                    </span>
                  ) : null}
                </div>
              ) : null}
              {chips.length ? (
                <div className="af-pc-ranks" data-testid="player-card-ranks">
                  {chips.map((chip) => (
                    <span key={chip.label} className="af-pc-rank">
                      <b className="af-num">{chip.value}</b> {chip.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="af-pc-acts">
                {actions.drop ? (
                  <button type="button" className="af-pc-btn af-pc-btn--drop" onClick={() => setConfirmDrop(true)} aria-label={l.dropAria(name)} data-testid="player-card-drop">
                    − {l.drop}
                  </button>
                ) : null}
                {actions.add ? (
                  <a className="af-pc-btn af-pc-btn--go" href={actions.add.href} aria-label={l.addAria(name)} data-testid="player-card-add">
                    + {l.add}
                  </a>
                ) : null}
                {actions.trade ? (
                  <a className="af-pc-btn af-pc-cta" href={actions.trade.href} data-testid="player-card-trade">
                    {c.proposeTrade}
                  </a>
                ) : null}
              </div>
              {/* Keeper leagues only (lib/keeper/keeperCardCost.ts): the cost under the league's rule and its value. */}
              {data?.keeperCost ? (
                <div className="af-pc-keeper" data-testid="player-card-keeper-cost">
                  <div className="af-pc-keeper-h">{data.keeperCost.headline}</div>
                  <div className="af-pc-faint">{data.keeperCost.detail}</div>
                  {data.keeperCost.value ? (
                    <div
                      className="af-pc-keeper-v"
                      data-surplus={data.keeperCost.value.surplus > 0 ? 'pos' : data.keeperCost.value.surplus < 0 ? 'neg' : 'even'}
                      data-testid="player-card-keeper-value"
                    >
                      {data.keeperCost.value.sentence}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* The trade block: your own player's toggle, or someone else's listing, with the platform's caveat. */}
              {league && block && (canMarkBlock || (!league.isYours && block.listed)) ? (
                <div className="af-pc-block">
                  {canMarkBlock ? (
                    <button type="button" className="af-pc-btn af-pc-block-btn" aria-pressed={onBlock} disabled={blockBusy} onClick={toggleBlock}>
                      {onBlock ? c.blockOn : c.blockPut}
                    </button>
                  ) : (
                    <span className="af-pc-block-tag">
                      {c.blockTag}
                      {block.teamName ? ` · ${block.teamName}` : ''}
                      {ago(block.since) ? c.blockListed(ago(block.since)!) : ''}
                    </span>
                  )}
                  {blockError ? (
                    <span className="af-pc-block-note" role="alert">
                      {blockError}
                    </span>
                  ) : null}
                  {block.note ? <span className="af-pc-block-note">{reason(block.note)}</span> : null}
                </div>
              ) : null}
            </div>
          </div>

          {status === 'loading' ? <p className="af-pc-absent">{c.loading}</p> : null}
          {status === 'error' ? <p className="af-pc-absent">{c.loadError}</p> : null}

          {/* Whether he can play outranks everything below; shown only when there is a designation. */}
          {data?.injury?.available ? (
            <div className="af-pc-injury">
              <span className="af-pc-injury-s" data-status={data.injury.data.status}>
                {injuryStatusText(data.injury.data.status, language)}
              </span>
              {data.injury.data.note || data.injury.data.bodyPart ? (
                <span className="af-pc-injury-n">{data.injury.data.note ?? data.injury.data.bodyPart}</span>
              ) : null}
              {/* The age stays beside the status: a designation is a point-in-time claim. */}
              <span className="af-pc-faint">
                {[ago(data.injury.data.reportedAt), data.injury.data.source].filter(Boolean).join(' · ')}
              </span>
            </div>
          ) : null}

          {data ? (
            <div className="af-pc-layout">
              <div className="af-pc-main">
                {tabs.length ? (
                  <div className="af-pc-tabs" role="tablist" aria-label={l.tabsLabel}>
                    {tabs.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        id={`af-pc-tab-${t}`}
                        aria-selected={activeTab === t}
                        aria-controls="af-pc-tabpanel"
                        className={`af-pc-tab${t === 'news' ? ' af-pc-tab--phone' : ''}`}
                        onClick={() => setTab(t)}
                        data-testid={`player-card-tab-${t}`}
                      >
                        {l.tabs[t]}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="af-pc-tabpanel" role="tabpanel" id="af-pc-tabpanel" aria-labelledby={activeTab ? `af-pc-tab-${activeTab}` : undefined}>
                  {activeTab === 'outlook' ? (
                    <>
                      {insight ? (
                        <div className="af-pc-insight">
                          <button type="button" className="af-pc-insight-h" onClick={() => setInsightOpen((v) => !v)} aria-expanded={insightOpen}>
                            <span className="af-pc-dot" aria-hidden />
                            <span className="af-pc-insight-t">
                              <span className="af-pc-label">{l.chimmyTake}</span> {insight.headline}
                            </span>
                            <span className="af-pc-chev" aria-hidden>
                              {insightOpen ? '⌃' : '⌄'}
                            </span>
                          </button>
                          {insightOpen ? (
                            <div className="af-pc-insight-d">
                              <p>{insight.detail}</p>
                              <p className="af-pc-basis">{c.basedOn(insight.basis)}</p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="af-pc-stats">
                        {afProjection?.weekly != null ? (
                          <Stat
                            label={l.thisWeek}
                            value={projectionNumber(afProjection.weekly)}
                            sub={<ProjectionFactorLine reasons={afProjection.afFactors?.reasons} testId="player-card-af-factors" />}
                          />
                        ) : null}
                        {afProjection?.restOfSeason != null ? (
                          <Stat label={l.restOfSeason} value={projectionNumber(afProjection.restOfSeason)} />
                        ) : afProjection?.fullSeason != null ? (
                          <Stat label={l.season} value={projectionNumber(afProjection.fullSeason)} />
                        ) : null}
                        {afProjection ? <Stat label={c.afPerGame} value={projectionNumber(afProjection.perGame)} sub={projectionUnit} /> : null}
                        {value ? <Stat label={value.label} value={value.value} sub={value.sub} /> : tradeValue ? <Stat label={l.value} value={projectionNumber(tradeValue)} /> : null}
                        {dynasty ? (
                          <Stat label={c.dynastyValue} value={Math.round(dynasty.dynastyValue!).toLocaleString(getAppIntlLocale())} sub={c.dynastyValueSub(dynasty.age)} />
                        ) : null}
                      </div>
                      {league?.isYours && isGamesCountSport(sport) ? (
                        <GamesCountWeekPanel leagueId={league.leagueId} playerIds={[followExternalId, followSleeperId]} />
                      ) : null}
                      <PlayerValueHistoryChart sleeperId={p?.sleeperId ?? subject.sleeperId} sport={sport} leagueId={league?.leagueId} unlocked={!depthLocked} />
                    </>
                  ) : null}

                  {activeTab === 'gamelog' && boxLogData && boxLogKey && p ? (
                    <PlayerGameLogTable
                      key={boxLogId ?? undefined}
                      compact
                      sport={p.sport}
                      playerName={p.name}
                      playerKey={boxLogKey}
                      prefetched={boxLogData}
                    />
                  ) : null}

                  {activeTab === 'gamelog' && !boxLogData && more ? (
                    <table className="af-pc-table" data-testid="player-card-gamelog">
                      <caption className="af-pc-label">{l.lastGames(more.gameLog[0]?.season ?? 0)}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{isWeeklySport(sport) ? l.colWeek : l.colDate}</th>
                          <th scope="col">{l.colOpp}</th>
                          <th scope="col" className="af-num">{l.colPts}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {more.gameLog.map((g) => (
                          <tr key={`${g.week}-${g.date ?? ''}`}>
                            <td>{isWeeklySport(sport) || !g.date ? g.week : g.date.slice(5).replace('-', '/')}</td>
                            <td>{g.opponent ?? '—'}</td>
                            <td className="af-num">{g.points.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}

                  {activeTab === 'career' && more ? (
                    <table className="af-pc-table" data-testid="player-card-career">
                      <thead>
                        <tr>
                          <th scope="col">{l.colSeason}</th>
                          <th scope="col">{l.colTeam}</th>
                          <th scope="col" className="af-num">{l.colGames}</th>
                          <th scope="col" className="af-num">{l.colPts}</th>
                          <th scope="col" className="af-num">{l.colPerGame}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {more.career.map((r) => (
                          <tr key={r.season}>
                            <td>{r.season}</td>
                            <td>{r.team ?? '—'}</td>
                            <td className="af-num">{r.games ?? '—'}</td>
                            <td className="af-num">{r.points != null ? r.points.toFixed(1) : '—'}</td>
                            <td className="af-num">{r.perGame != null ? r.perGame.toFixed(1) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}

                  {activeTab === 'depth' && more?.depthChart ? (
                    <div data-testid="player-card-depth">
                      <div className="af-pc-label">{l.depthAt(more.depthChart.position)}</div>
                      <ol className="af-pc-depth">
                        {more.depthChart.rows.map((r) => (
                          <li key={`${r.rank}-${r.name}`} data-me={r.isSubject || undefined}>
                            <span className="af-num">{r.rank}</span> {r.name}
                            {r.rank === 1 ? <span className="af-pc-faint"> · {l.starter}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {activeTab === 'schedule' ? (
                    <>
                      {data.schedule.available ? (
                        <>
                          <div className="af-pc-label">{c.nextUp}</div>
                          {data.schedule.data.kind === 'daily' ? (
                            <DailyGameRows schedule={data.schedule.data} language={language} />
                          ) : (
                            <>
                              <ScheduleRows weeks={data.schedule.data.weeks} language={language} />
                              <p className="af-pc-basis">{scheduleProjectionNote(data.schedule.data, language)}</p>
                              {data.schedule.data.weeks.some((w) => w.afProjection != null) ? (
                                <p className="af-pc-basis">{c.projNote(PROJECTION_PROVIDER_LABEL)}</p>
                              ) : null}
                            </>
                          )}
                        </>
                      ) : null}
                      {league?.playoffSchedule.available ? (
                        <>
                          <div className="af-pc-label">
                            {c.playoffSchedule(
                              league.playoffSchedule.data.startWeek,
                              league.playoffSchedule.data.startWeek + league.playoffSchedule.data.weeks.length - 1,
                            )}
                          </div>
                          <ScheduleRows weeks={league.playoffSchedule.data.weeks} language={language} />
                        </>
                      ) : null}
                      {league && league.yourRoster.length > 0 && position ? (
                        <>
                          <div className="af-pc-label">{c.yourRosterAt(position)}</div>
                          {league.yourRoster.map((r) => (
                            <div key={r.name} className="af-pc-row">
                              <span className="af-pc-row-k">{r.name}</span>
                              <span className="af-pc-row-v af-num">{r.value != null ? r.value.toLocaleString(getAppIntlLocale()) : '—'}</span>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {activeTab === 'history' ? (
                    depthLocked && depth ? (
                      <CoreDepthLock
                        access={depth}
                        what={league ? lockSubjectText('Trades in this league', language) : lockSubjectText('Trade history and similar players', language)}
                        lang={language}
                      />
                    ) : (
                      <>
                        {depth ? <FreeUntilNote access={depth} lang={language} /> : null}
                        {league ? (
                          <>
                            <div className="af-pc-label">{c.tradesInLeague}</div>
                            <TradeRows trades={league.trades} subject={name} language={language} />
                          </>
                        ) : (
                          <>
                            {data.trades.available ? (
                              <>
                                <div className="af-pc-label">{c.recentTrades}</div>
                                <TradeRows trades={data.trades.data} subject={name} language={language} />
                                <p className="af-pc-basis">{c.importedScope}</p>
                              </>
                            ) : null}
                            {data.comps.available ? (
                              <>
                                <div className="af-pc-label">{c.similarPrice}</div>
                                <div className="af-pc-chips">
                                  {data.comps.data.map((comp) => (
                                    <button key={comp.sleeperId} type="button" className="af-pc-chip" onClick={() => openComp(comp)}>
                                      {comp.name}
                                      <span className="af-pc-faint af-num"> {comp.value.toLocaleString(getAppIntlLocale())}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            ) : null}
                          </>
                        )}
                      </>
                    )
                  ) : null}

                  {/* Phones only: on a wide screen the same news sits in the side column. */}
                  {activeTab === 'news' ? <div className="af-pc-news-tab">{newsBody}</div> : null}
                </div>
              </div>

              <aside className="af-pc-aside" aria-label={l.tabs.news}>
                <div className="af-pc-aside-h">{l.tabs.news}</div>
                {/* Not while the phone News tab holds the same feeds: one copy, one set of clip reads. */}
                {activeTab === 'news' ? null : newsBody}
              </aside>
            </div>
          ) : null}
        </div>

        {confirmDrop && actions.drop ? (
          <DropConfirmSheet
            name={name}
            position={position}
            team={team}
            sport={sport}
            image={image}
            href={actions.drop.href}
            language={language}
            onCancel={() => setConfirmDrop(false)}
          />
        ) : null}
      </div>
    </div>
  )
}
