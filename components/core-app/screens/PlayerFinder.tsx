'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-player-finder.css'
import { PlayerVerdict } from '@/components/core-app/player-finder/PlayerVerdict'
import { SwapCandidates } from '@/components/core-app/player-finder/SwapCandidates'
import { RecommendedMoves } from '@/components/core-app/player-finder/RecommendedMoves'
import { LeagueOwnershipCard } from '@/components/core-app/player-finder/LeagueOwnershipCard'
import { StickyActionBar } from '@/components/core-app/player-finder/StickyActionBar'
import { TradeVisual } from '@/components/core-app/player-finder/TradeVisual'
import { TradeWindow } from '@/components/core-app/player-finder/TradeWindow'
import { TradeWindows } from '@/components/core-app/player-finder/TradeWindows'
import { HelpDot } from '@/components/core-app/player-finder/HelpDot'
import { TopicTip } from '@/components/core-app/TopicTip'
import { PlayerSearchBox } from '@/components/core-app/player-finder/PlayerSearchBox'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import { PlayerCompare } from '@/components/core-app/player-finder/PlayerCompare'
import { GameDayBanner, type GameDayLeague } from '@/components/core-app/player-finder/GameDayBanner'
import { GameDayTriage } from '@/components/core-app/player-finder/GameDayTriage'
import type { GameDayTriage as GameDayTriageData } from '@/lib/core-app/gameDayTriage'
import { LockClock } from '@/components/core-app/player-finder/LockClock'
import { playerRef } from '@/lib/core-app/playerRef'
import { composePlayerMoves, readiness, type PlayerMove } from '@/lib/core-app/playerMoves'
import { lineupLink, platformLabel } from '@/lib/core-app/platformLinks'
import { reportedLabel } from '@/lib/core-app/injuryReport'
import { pregameInactive } from '@/lib/core-app/pregameInactive'
import { byeChip, byeStatus } from '@/lib/core-app/byeStatus'
import { CoreDepthGate, CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { ageText } from '@/lib/core-app/shellCopy'
import { slotText } from '@/lib/core-app/playerMovesCopy'
import { designationText, finderCopy, platformListText, reasonText, type FinderCopy } from '@/lib/core-app/playerFinderCopy'

/** The loader hands a Date across the server boundary; tests and fixtures may hand an ISO string. */
function asIso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : v
}
import type { LeagueImpact } from '@/lib/core-app/playerImpact'
import { afEngineForLeague } from '@/lib/core-app/afEngineCarry'
import type { LeagueSlot, PlayerDetail, PlayerMatch } from '@/lib/core-app/playerFinder'
import type { PlayerLeagueView } from '@/lib/core-app/playerLeagueView'
import type { PlayerTradeVisual } from '@/lib/core-app/playerTradeVisual'
import type { ManagerPresence } from '@/lib/core-app/managerPresence'
import type { PitchPackage } from '@/lib/core-app/tradePitch'
import type { RecentPlayerSearch } from '@/lib/core-app/recentPlayerSearches'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerDepth } from '@/lib/core-app/playerDepth'
import type { PlayerShares } from '@/lib/core-app/playerShares'
import type { LeagueShareView } from '@/lib/core-app/playerSharesLeague'
import { PlayerSharesBoard } from '@/components/core-app/player-finder/PlayerSharesBoard'
import { LiveGameBadge } from '@/components/core-app/player-finder/LiveGameBadge'
import type { LiveGameBadge as LiveGameBadgeData } from '@/lib/core-app/liveGameBadge'
import { InjuryTimelineChip } from '@/components/core-app/player-finder/InjuryTimelineChip'
import { LeaguePicker } from '@/components/core-app/player-finder/LeaguePicker'
import { LeagueCalls } from '@/components/core-app/player-finder/LeagueCalls'
import { LeagueStrip } from '@/components/core-app/player-finder/LeagueStrip'
import { FreeAgentBids } from '@/components/core-app/player-finder/FreeAgentBids'
import type { FreeAgentBids as FreeAgentBidsData } from '@/lib/core-app/freeAgentBids'
import { DepthChartBackups } from '@/components/core-app/player-finder/DepthChartBackups'
import type { DepthChartView } from '@/lib/core-app/depthChart'
import { WhoStartsHim } from '@/components/core-app/player-finder/WhoStartsHim'
import type { WhoStartsHim as WhoStartsHimData } from '@/lib/core-app/whoStartsHim'
import { ValueTrend } from '@/components/core-app/player-finder/ValueTrend'
import type { ValueTrend as ValueTrendData } from '@/lib/core-app/valueTrend'
import type { MatchupOutlook } from '@/lib/core-app/matchupOutlook'
import { buildLeagueStrip } from '@/lib/core-app/leagueStrip'
import { leagueCall } from '@/lib/core-app/leagueCall'
import { PlayerSeasonCard } from '@/components/core-app/player-finder/PlayerSeasonCard'
import { PlayerNextGames } from '@/components/core-app/player-finder/PlayerNextGames'
import { PlayerNews } from '@/components/core-app/player-finder/PlayerNews'

/**
 * Screen 3 — Player Finder.
 *
 * "One name in — every platform, league, slot, injury and the move to make."
 *
 * The handoff prints a line under the search box that is really a promise:
 * "Stats, injuries and news come from live sports data — never an invented
 * number." This screen keeps it literally — every figure shown is read from an
 * ingested row, and everything we cannot compute says so in words instead of
 * rendering a dash that looks like a measurement.
 *
 * ── THREE VIEWS, ONE DOM ─────────────────────────────────────────────────────
 *
 *   CORE     /core/players — every league you play, at once. The 360 | 1fr | 384
 *            grid: search rail, main column, decision column.
 *   LEAGUE   /core/players?league=… — the same screen with `leagueView` on top:
 *            in THIS league, is he yours, someone's (named), or free. It is a
 *            promotion, not a filter (38a·4): the cross-league table stays.
 *   MOBILE   ≤720px — search, player card, the league list, the verdict with
 *            its "Open in <platform>" buttons. The stat tiles, move cards and
 *            season table are desktop-only; the verdict card carries the move.
 *            Same DOM, ordered so the phone reads top-to-bottom without a
 *            second copy of anything — see af-player-finder.css.
 *
 * ⚠ TWO PANELS IN THE DESIGN ARE NOT BUILT, ON PURPOSE, BECAUSE NOTHING BACKS
 * THEM — and two more were built only as far as the data goes. Measured before
 * building rather than discovered afterwards:
 *
 *   - INJURY TIMELINE (WED DNP / THU LP / FRI FP). No provider we ingest carries
 *     practice participation; `sportsInjury` holds a status and a description and
 *     nothing else. The status we DO have renders as the readiness chip.
 *   - SEASON AVG. `PlayerGameStat.fantasyPoints` defaults to 0 and is written
 *     under whichever scoring the importer used — not this league's, not
 *     standard. An average of that would be a number with no name.
 *   - TRADE WINDOW · WHO'S AROUND NOW — built as "when they move" (2026-09-05).
 *     The usual window, the last move, the need and the record are real:
 *     managerPresence.ts reads them from the league's own transaction history
 *     and rosters. "Online now" is NOT claimed, because nothing we hold records
 *     when a manager is in the app; the dot pulses only for a move in the last
 *     day. ESPN and Yahoo activity is not ingested, so those rows carry the need
 *     and record and say the window is missing.
 *   - RECENTLY SEARCHED — built 2026-09-02, per account (`recent_player_searches`).
 *
 * ⚠ THE CHIMMY CARD IS COMPUTED, NOT GENERATED — see PlayerVerdict for why a
 * page-load LLM call was rejected.
 *
 * Spanish (2026-10-04): the screen's own words come from lib/core-app/playerFinderCopy.ts, built at
 * render from `useOptionalLanguage`, which starts at English on server and client alike, so the
 * first paint agrees. What the loaders hand over stays English in the data — the readiness label,
 * the bye chip, the report time, the reasons — and is translated only where it is drawn, by the
 * shared translators (`coreUiCopy`, `ageText`, `slotText`, `reasonText`). The subcomponents carry
 * their own copy.
 */

export type PlayerFinderProps = {
  query: string
  matches: PlayerMatch[]
  detail: PlayerDetail | null
  leagueCount: number
  /**
   * The league held in the rail, when there is one.
   *
   * ⚠ IT FILTERS. Guap's decision, 2026-09-02, reversing the 38a·4 rule this
   * screen shipped with (promote and mark, never filter): with a league in
   * context the table, the moves, the verdict and the header numbers are that
   * league's alone, and "All leagues →" is the way out. Without one, the
   * cross-league view is unchanged.
   */
  selectedLeagueId?: string | null
  /**
   * The league-scoped answer for the held league — who has him there. Loaded
   * by the page only when a league is in context and the player resolved to a
   * platform id; null otherwise, and the screen renders no card.
   */
  leagueView?: PlayerLeagueView | null
  /** The account's recent searches for the rail, newest first. Empty when signed out. */
  recent?: RecentPlayerSearch[]
  /**
   * "Trade for him", as a visual: loaded by the page only when the held
   * league's card says another manager has him. Null otherwise.
   */
  tradeVisual?: SectionState<PlayerTradeVisual> | null
  /**
   * Who to pitch for him and when they move — the held league, or in the core
   * view the first league where someone else has him. Null when no league
   * applies; an unavailable state renders its reason.
   */
  presence?: SectionState<ManagerPresence> | null
  /**
   * Core view only: the presence of every league where someone ELSE has him,
   * for the cross-league "who's reachable" card. Loaded in place of `presence`
   * when there is at least one such league; `windowsUnread` counts the ones
   * whose presence could not be loaded.
   */
  windows?: ManagerPresence[] | null
  windowsUnread?: number
  /**
   * The finder's home before a search (2026-09-06): your flagged starters
   * across every league with their locks. Rendered only when no player is
   * open; the loader is not run when one is.
   */
  triage?: SectionState<GameDayTriageData> | null
  /**
   * A second player held beside the first (`?vs=`). When present the main
   * column shows the two side by side instead of the single detail card; the
   * decision column stays about the first.
   */
  compare?: PlayerDetail | null
  /** A `?vs=` was asked for — so a locked viewer is told why no comparison appeared. */
  compareRequested?: boolean
  /**
   * Player depth (AF Pro): compare, the trade visual, trade windows, pickups, the verdict and the
   * bench swaps. The page's loaders already skipped the data behind a lock; this decides what is
   * drawn. Null (the public page, tests) renders everything as before.
   */
  depthAccess?: CoreDepthAccess | null
  /**
   * The deeper card (Phase 1, lib/core-app/playerDepth.ts): this season against the projection,
   * next games with the market's read, news, and per-league value (`leagueValues` is null for a
   * viewer without AF Pro). Null renders the card exactly as before.
   */
  depth?: PlayerDepth | null
  /** "Your shares" (Phase 2): the players you roster most across the picked leagues; home only. */
  shares?: SectionState<PlayerShares> | null
  /** League mode: the same players read in the held league (holder, value, season points). */
  leagueShares?: LeagueShareView | null
  /** Every league the account plays, for the "pick leagues" control. */
  pickLeagues?: Array<{ id: string; name: string; platform: string | null }>
  /** The account's saved pick (already intersected with `pickLeagues`); null = all. */
  savedPicks?: string[] | null
  /**
   * Every league where he is a free agent, with a claim link and — AF Pro — a suggested FAAB bid
   * (lib/core-app/freeAgentBids.ts). The page withholds the bids for a locked viewer.
   */
  freeAgentBids?: FreeAgentBidsData | null
  /** His team's depth chart at his spot, with where each player around him is in your leagues (depthChartBackups.ts). */
  depthChart?: DepthChartView | null
  /** Where he is yours: the other teams he would start for (AF Pro; whoStartsHimLoader.ts). */
  whoStartsHim?: WhoStartsHimData | null
  /** His market value over 30 days per book your leagues use; the nudge is AF Pro (valueTrendLoader.ts). */
  valueTrend?: ValueTrendData | null
  /** Where each upcoming opponent ranks for points allowed to his position (matchupOutlookLoader.ts). */
  matchupOutlook?: MatchupOutlook | null
  /**
   * The server's clock, ISO. The trade window's "pitch now / not now" is read
   * against it so the sentence hydrates to what was rendered.
   */
  nowIso?: string
  /** His game this week, live or final, and his points in your leagues (liveGameBadgeLoader.ts). */
  liveGame?: LiveGameBadgeData | null
  /**
   * False on the public `/players/{slug}` surface when nobody is signed in.
   *
   * ⚠ THIS CHANGES WHY A SECTION IS EMPTY, WHICH IS THE WHOLE POINT. The
   * per-league loaders are handed no user and no league ids, so they correctly
   * report that they cannot cross-reference — but "we have no platform id for
   * this player" is a statement about our ingest, and to a signed-out visitor
   * the true statement is "you are not signed in". Showing the ingest reason to
   * a stranger reads as a broken product rather than as a locked door.
   *
   * Defaults to true so every existing signed-in call site is unchanged.
   */
  signedIn?: boolean
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="af-pf-unavailable">{reason}</p>
}

/**
 * The detail headshot, with the one-letter placeholder as the fallback for a
 * missing image AND for one the CDN 404s. The failed src is remembered rather
 * than a boolean so a different player's image gets a fresh attempt.
 */
/**
 * The Sleeper CDN headshot, when the catalog row carries no image. Every NFL player with a Sleeper id
 * has one there; a miss falls through to the letter tile via `onError`, never a broken image.
 */
function headshotFor(player: { imageUrl: string | null; sleeperId?: string | null; sport: string }): string | null {
  if (player.imageUrl) return player.imageUrl
  return player.sport === 'NFL' && player.sleeperId ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg` : null
}

function Headshot({ src, name }: { src: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || src === failedSrc) {
    return (
      <div className="af-pf-headshot af-pf-headshot--none" aria-hidden>
        {name.charAt(0)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-pf-headshot"
      src={src}
      alt=""
      width={72}
      height={72}
      onError={() => setFailedSrc(src)}
    />
  )
}

function StatTile({
  label,
  help,
  tip,
  state,
  value,
  tone,
  why = (reason) => reason,
}: {
  label: string
  help?: string
  /** The `?` beside the label, per the handoff's tooltip pattern. */
  tip?: { title: string; body: string }
  state?: SectionState<unknown>
  value?: string | null
  tone?: 'good' | 'warn' | 'bad'
  /** A loader's reason in the reader's language (`reasonText`); English as written by default. */
  why?: (reason: string) => string
}) {
  const missing = state ? !state.available : value == null
  return (
    <div className="af-pf-tile" data-missing={missing} data-tone={missing ? undefined : tone}>
      <div className="af-pf-tile-value af-num">{missing ? '—' : value}</div>
      <div className="af-pf-tile-label">
        <span className="af-label">{label}</span>
        {tip ? <HelpDot title={tip.title} body={tip.body} /> : null}
      </div>
      {missing && state && !state.available ? (
        <div className="af-pf-tile-why">{why(state.reason)}</div>
      ) : help ? (
        <div className="af-pf-tile-why">{help}</div>
      ) : null}
    </div>
  )
}

/*
 * The signed-out replacement for a per-league section's reason is `signInReason` in
 * playerFinderCopy.ts: one sentence, and it names what is behind the door rather than just asking
 * for a sign-in — the sections it covers are the reason this page is worth an account at all.
 */

/** "Sleeper and ESPN", "Sleeper, ESPN and Yahoo" — "y" in Spanish. */
function listPlatforms(platforms: string[], language: string): string {
  return platformListText([...new Set(platforms.map(platformLabel))], language)
}

function slotTone(slot: string, move: PlayerMove | undefined): 'good' | 'warn' | 'bad' | 'none' {
  if (slot === 'STARTER') return 'good'
  if (slot === 'IR SLOT') return 'warn'
  if (slot === 'BENCH' || slot === 'TAXI') return move ? 'bad' : 'none'
  return 'none'
}

/**
 * One row of "Every platform, every league": the league slot joined to its
 * impact row (league-scored points) and to the move that fixes it, if any.
 */
type LeagueRow = {
  slot: LeagueSlot
  impact: LeagueImpact | undefined
  move: PlayerMove | undefined
  held: boolean
}

const ROW_RANK: Record<string, number> = { bad: 0, warn: 1, none: 2, good: 3, other: 4 }

function rowTone(r: LeagueRow): 'bad' | 'warn' | 'none' | 'good' | 'other' {
  if (!r.slot.isYours) return 'other'
  if (r.move) return r.move.tone === 'good' ? 'none' : r.move.tone
  return r.slot.slot === 'STARTER' ? 'good' : 'none'
}

function rowAction(r: LeagueRow, last: string, t: FinderCopy, language: string): ReactNode {
  if (!r.slot.isYours) {
    return (
      <Link href={`/core/trades?league=${encodeURIComponent(r.slot.leagueId)}`} className="af-pf-link">
        {t.tradeFor(last)}
      </Link>
    )
  }
  if (r.move && r.move.tone !== 'good' && r.move.link) {
    return r.move.link.external ? (
      <a className="af-pf-link" href={r.move.link.href} target="_blank" rel="noopener noreferrer">
        {t.whereToFix}
      </a>
    ) : (
      <Link className="af-pf-link" href={r.move.link.href}>
        {t.whereToFix}
      </Link>
    )
  }
  if (r.slot.slot === 'STARTER') return <span className="af-pf-nothing">{t.nothingToDo}</span>
  if (r.impact?.startOver && r.impact.startOver.delta <= 0) {
    return (
      <span className="af-pf-nothing" title={t.projectsHigher(r.impact.startOver.name)}>
        {t.benchIsRight}
      </span>
    )
  }
  if (r.slot.slot === 'IR SLOT') return <span className="af-pf-nothing">{t.onIr}</span>
  return (
    <span className="af-pf-nothing" title={r.impact && !r.impact.afPoints.available ? reasonText(r.impact.afPoints.reason, language) : undefined}>
      {t.noCall}
    </span>
  )
}

export function PlayerFinder({
  query,
  matches,
  detail,
  leagueCount,
  selectedLeagueId = null,
  leagueView = null,
  recent = [],
  tradeVisual = null,
  presence = null,
  windows = null,
  windowsUnread = 0,
  triage = null,
  compare = null,
  compareRequested = false,
  depthAccess = null,
  depth = null,
  shares = null,
  leagueShares = null,
  pickLeagues = [],
  savedPicks = null,
  freeAgentBids = null,
  depthChart = null,
  whoStartsHim = null,
  valueTrend = null,
  matchupOutlook = null,
  nowIso = new Date().toISOString(),
  liveGame = null,
  signedIn = true,
}: PlayerFinderProps) {
  const { language } = useOptionalLanguage()
  const t = finderCopy(language)
  /** A loader's reason, in the reader's language (whole, or English as written). */
  const why = (reason: string) => reasonText(reason, language)
  const depthLocked = depthAccess?.unlocked === false
  /*
   * Swap the ingest-level reason for the sign-in one on exactly the sections
   * that are gated. Everything else on this screen — bio, injury, projection,
   * season statistics — is public sports data and keeps its real reason.
   */
  const gatedReason = (state: SectionState<unknown> | { available: false; reason: string }) =>
    !signedIn ? t.signInReason : why((state as { reason: string }).reason)

  const leagueParam = selectedLeagueId ? `&league=${encodeURIComponent(selectedLeagueId)}` : ''

  // ── Derived, once, from the loaders' output ──────────────────────────────
  /*
   * League mode: everything below is scoped to the held league. The page's
   * loaders already narrowed their reads to it; this filter is what keeps the
   * screen honest if a loader ever returns more than it was asked for.
   */
  const leagueMode = Boolean(signedIn && selectedLeagueId)
  const inScope = (leagueId: string) => !leagueMode || leagueId === selectedLeagueId

  /*
   * Compare links. `vs` holds the second player; Swap turns the pair round and
   * Clear drops back to the single card. Every match row offers itself as the
   * second name while a player is open.
   */
  const detailRef = detail ? playerRef(detail.player.sport, detail.player.externalId) : null
  const compareRef = compare ? playerRef(compare.player.sport, compare.player.externalId) : null
  const vsHref = (ref: string) =>
    detailRef ? `/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(detailRef)}&vs=${encodeURIComponent(ref)}${leagueParam}` : null
  const swapHref =
    detailRef && compareRef && compare
      ? `/core/players?q=${encodeURIComponent(compare.player.name)}&player=${encodeURIComponent(compareRef)}&vs=${encodeURIComponent(detailRef)}${leagueParam}`
      : '/core/players'
  const clearHref = detailRef ? `/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(detailRef)}${leagueParam}` : '/core/players'

  /** The trade visual's opening package, for the pitch on the trade-window card. */
  const pitchPackage: PitchPackage =
    tradeVisual?.available && tradeVisual.data.recommended
      ? { give: tradeVisual.data.recommended.give.map((a) => a.name), fairness: tradeVisual.data.recommended.fairness }
      : null
  const allLeaguesHref = detail
    ? `/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(detail.player.sport, detail.player.externalId))}`
    : '/core/players'

  const impactRows: LeagueImpact[] = (detail?.impact.available ? detail.impact.data : []).filter((i) =>
    inScope(i.leagueId)
  )
  const impactById = new Map(impactRows.map((i) => [i.leagueId, i]))
  const injuryStatus = detail?.injury.available ? detail.injury.data.status : null
  const moves: PlayerMove[] = detail
    ? composePlayerMoves({
        playerName: detail.player.name,
        injuryStatus,
        impact: impactRows,
        freeAgents: (detail.recommendedMoves.available ? detail.recommendedMoves.data : []).filter((m) =>
          inScope(m.leagueId)
        ),
        // Legal moves only (2026-09-06): a swap the platform would refuse right now is marked locked.
        kickoffs: detail.kickoffs ?? {},
        nowIso,
        playerTeam: detail.player.team,
        notPlaying: (() => {
          const s = byeStatus(detail.player.team, detail.kickoffs ?? {}, detail.scheduleWeek?.week ?? null, detail.kickoffsUnresolved ?? 0)
          return s === 'bye' || s === 'no-game'
        })(),
      })
    : []
  const moveByLeague = new Map<string, PlayerMove>()
  for (const m of moves) if (m.tone !== 'good' && !moveByLeague.has(m.leagueId)) moveByLeague.set(m.leagueId, m)
  const readyBase = detail ? readiness(injuryStatus, detail.injury.available) : null
  // Out inside the last two hours before his kickoff is the inactive list; the chip says so (pregameInactive.ts).
  const inactive =
    detail?.injury.available && detail.game?.available ? pregameInactive(detail.injury.data.status, asIso(detail.injury.data.reportedAt), detail.game.data.kickoff) : null
  const ready = inactive && readyBase ? { tone: 'bad' as const, label: 'Inactive' } : readyBase
  const last = detail ? (detail.player.name.trim().split(/\s+/).slice(-1)[0] ?? detail.player.name) : ''

  // Per-league value (AF Pro): null for a locked viewer, which drops the column entirely.
  const leagueValues = depth?.leagueValues ?? null
  const leagueRows: LeagueRow[] = (detail?.leagues.available ? detail.leagues.data : [])
    .filter((slot) => inScope(slot.leagueId))
    .map((slot) => ({
      slot,
      impact: impactById.get(slot.leagueId),
      move: moveByLeague.get(slot.leagueId),
      held: slot.leagueId === selectedLeagueId,
    }))
    /*
     * The held league first, then what needs you: a wrong slot outranks a right
     * one, and a league where someone else has him comes last — it is context
     * for a trade, not a lineup to fix.
     */
    .sort((a, b) => {
      if (a.held !== b.held) return a.held ? -1 : 1
      return ROW_RANK[rowTone(a)] - ROW_RANK[rowTone(b)]
    })

  const yoursCount = leagueRows.filter((r) => r.slot.isYours).length
  const unmatched = (detail?.rosterCoverage.unmatched ?? []).filter((u) => inScope(u.leagueId))

  // The league strip: every league in scope as one chip — cross-league view only (leagueStrip.ts).
  const stripChips =
    detail && signedIn && !leagueMode && detail.leagues.available
      ? buildLeagueStrip({
          leagues: pickLeagues,
          scope: savedPicks,
          slots: detail.leagues.data,
          unmatched: detail.rosterCoverage.unmatched,
          playerName: detail.player.name,
          readinessTone: ready?.tone ?? null,
        })
      : []
  const stripLeagueHref = (leagueId: string) =>
    detail
      ? `/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(detail.player.sport, detail.player.externalId))}&league=${encodeURIComponent(leagueId)}`
      : '/core/players'

  /*
   * Game day (2026-09-06). His kickoff is the lock every league row counts
   * down to; when the feed says Questionable / Doubtful / Out, the card leads
   * with it and one Open-lineup button per league where he is in YOUR
   * starting lineup. Starting is the impact row's word when it has one, else
   * the slot's.
   */
  const gameKickoff = detail?.game?.available ? detail.game.data.kickoff : null
  const gameDayStatus = ready && (ready.tone === 'bad' || ready.tone === 'warn') ? ready : null
  // Not playing this week: a bye by the slate's shape, or absent from the schedule (byeStatus.ts keeps the two apart).
  const byeState = detail ? byeStatus(detail.player.team, detail.kickoffs ?? {}, detail.scheduleWeek?.week ?? null, detail.kickoffsUnresolved ?? 0) : 'unknown'
  const byeMarkBase = byeChip(byeState, detail?.scheduleWeek?.week ?? null)
  const byeMark = byeMarkBase && (byeState === 'bye' || byeState === 'no-game') ? { ...byeMarkBase, kind: byeState } : null
  const injuryReportedAt = detail?.injury.available ? asIso(detail.injury.data.reportedAt) : null
  const startingLeagues: GameDayLeague[] = leagueRows
    // Best ball has no lineup to open: the platform picks the scoring lineup itself (leagueBestBall.ts).
    .filter((r) => r.slot.isYours && !r.slot.bestBall && (r.impact ? r.impact.isStarting : r.slot.slot === 'STARTER'))
    .map((r) => ({
      leagueId: r.slot.leagueId,
      leagueName: r.slot.leagueName,
      platform: r.slot.platform,
      link: lineupLink({
        id: r.slot.leagueId,
        platform: r.slot.platform,
        platformLeagueId: r.slot.platformLeagueId,
        season: r.slot.season,
        name: r.slot.leagueName,
        teamId: r.slot.teamExternalId,
      }),
    }))
  const benchedCount = yoursCount - startingLeagues.length
  const elsewhereCount = leagueRows.filter((r) => !r.slot.isYours).length
  // In league mode the header's numbers are the league's own, when we have them.
  const leagueProj = leagueMode && leagueView ? leagueView.afPoints : null
  /*
   * AllFantasy's own engine. League-free from the loader (PPR); carried into a league's scoring here
   * with the provider's generic and league numbers this screen already holds — the same carry-over
   * every /core surface uses, so the AF here matches the AF on My Team for the same league.
   */
  const afPpr = detail?.afProjection?.available ? detail.afProjection.data.points : null
  const providerGeneric = detail?.projection.available ? detail.projection.data.points : null
  const afIn = (leaguePoints: number | null | undefined): number | null =>
    afEngineForLeague(
      afPpr == null ? null : { projectedPoints: afPpr, position: detail?.player.position ?? null },
      providerGeneric,
      leaguePoints ?? null,
    )
  const afTile =
    afPpr == null
      ? null
      : leagueProj
        ? afIn(leagueProj.available ? leagueProj.data.points : null)
        : afPpr
  const leagueRank = leagueMode && leagueView ? leagueView.positionRank : null
  const otherMatches = detail
    ? matches.filter((m) => !(m.externalId === detail.player.externalId && m.sport === detail.player.sport))
    : matches

  return (
    <div className="af-core af-pf af-pf--2a" data-public={!signedIn} data-has-detail={Boolean(detail)}>
      {/* ── Search rail (360px) ─────────────────────────────────────── */}
      {/*
        The rail owns the search, the matches and the live-data promise. h1 is
        "Player Finder" and the player name is h2 — the SEO order the handoff
        specifies.
      */}
      <aside className="af-pf-rail" aria-label={t.railLabel}>
        <h1 className="af-display af-pf-h1">{t.h1}</h1>
        {/*
          The search box: a GET form as before, with suggestions as you type
          layered on top (2026-09-05). See PlayerSearchBox for the rate-limit
          behaviour and why the form never depends on the suggestions.
        */}
        <PlayerSearchBox query={query} selectedLeagueId={selectedLeagueId} signedIn={signedIn} />

        {/*
          ── Matches ─────────────────────────────────────────────────
          Suppressed entirely on the public page, where there is no query and
          nothing to match: a "MATCHES · 0" header above "type at least two
          characters" is the search box restating itself, and on a page a
          stranger landed on from Google it reads as a failed search they never
          ran.

          On a phone with a player already resolved, the full card is hidden
          and the OTHER matches collapse to a chip row under the search — the
          player card is what the screen was opened for, and it goes first.
        */}
        {signedIn || matches.length > 0 ? (
          <section className={`af-card af-pf-matches${detail ? ' af-pf-d-only' : ''}`}>
            <header className="af-pf-section-head">
              <h2 className="af-label">{t.matches(matches.length)}</h2>
            </header>

            {matches.length === 0 ? (
              <p className="af-pf-unavailable">
                {query.trim().length < 2 ? t.typeTwo : t.noMatch(query)}
              </p>
            ) : (
              <ul className="af-pf-match-list">
                {matches.map((m) => (
                  <li key={`${m.sport}-${m.externalId}`} className="af-pf-match-li">
                    <Link
                      // Sport-qualified: `externalId` alone is ambiguous across
                      // sports and opened whichever athlete came back first.
                      href={`/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(m.sport, m.externalId))}${leagueParam}`}
                      className="af-pf-match"
                      data-active={
                        detail?.player.externalId === m.externalId && detail?.player.sport === m.sport
                      }
                    >
                      <PlayerAvatar src={m.imageUrl} name={m.name} size={32} />
                      <span className="af-pf-match-text">
                        <span className="af-pf-match-name">{m.name}</span>
                        <span className="af-pf-match-meta">
                          {m.position || m.team ? (
                            <>
                              {m.position ?? ''}
                              {m.position && m.team ? ' · ' : ''}
                              {m.team ? (
                                <>
                                  <TeamLogo sport={m.sport} team={m.team} />
                                  {m.team}
                                </>
                              ) : null}
                            </>
                          ) : (
                            t.noPosition
                          )}
                        </span>
                      </span>
                    </Link>
                    {/* The row as the second name — only while another player is open. */}
                    {detail && !(detail.player.externalId === m.externalId && detail.player.sport === m.sport) && vsHref(playerRef(m.sport, m.externalId)) ? (
                      <Link href={vsHref(playerRef(m.sport, m.externalId)) as string} className="af-pf-match-vs" aria-label={t.compareWithName(m.name)}>
                        vs
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {/*
          ── Recently searched ────────────────────────────────────────
          Per account (Guap, 2026-09-02), newest first, the player on screen
          excluded by the loader. Empty for a new account and when signed out,
          and then it renders nothing rather than an empty heading.
        */}
        {signedIn && recent.length > 0 ? (
          <section className="af-card af-pf-recent" aria-labelledby="af-pf-recent-h">
            <header className="af-pf-section-head">
              <h2 className="af-label" id="af-pf-recent-h">
                {t.recentlySearched}
              </h2>
            </header>
            <ul className="af-pf-match-list">
              {recent.map((r) => (
                <li key={`${r.sport}-${r.externalId}`}>
                  <Link
                    href={`/core/players?q=${encodeURIComponent(r.name)}&player=${encodeURIComponent(playerRef(r.sport, r.externalId))}${leagueParam}`}
                    className="af-pf-match af-pf-recent-row"
                  >
                    <PlayerAvatar src={r.imageUrl ?? null} name={r.name} size={32} />
                    <span className="af-pf-match-text">
                      <span className="af-pf-match-name">{r.name}</span>
                      <span className="af-pf-match-meta af-num">
                        {r.position || r.team ? (
                          <>
                            {r.position ?? ''}
                            {r.position && r.team ? ' · ' : ''}
                            {r.team ? (
                              <>
                                <TeamLogo sport={r.sport} team={r.team} />
                                {r.team}
                              </>
                            ) : null}
                          </>
                        ) : (
                          r.sport
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail && otherMatches.length > 0 ? (
          <div className="af-pf-m-only af-pf-others" aria-label={t.otherMatches}>
            <span className="af-label">{t.alsoMatched}</span>
            {otherMatches.slice(0, 4).map((m) => (
              <span key={`${m.sport}-${m.externalId}`} className="af-pf-other-pair">
                <Link
                  href={`/core/players?q=${encodeURIComponent(query)}&player=${encodeURIComponent(playerRef(m.sport, m.externalId))}${leagueParam}`}
                  className="af-chip af-pf-other"
                >
                  {m.name}
                  {m.position ? <span className="af-pf-other-pos af-num">{m.position}</span> : null}
                </Link>
                {/* The same "vs" the desktop rows carry, joined to the chip so it reads as one pill. */}
                {vsHref(playerRef(m.sport, m.externalId)) ? (
                  <Link href={vsHref(playerRef(m.sport, m.externalId)) as string} className="af-chip af-pf-other-vs" aria-label={t.compareWithName(m.name)}>
                    vs
                  </Link>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        {/*
          The live-data promise is pinned to the foot of the rail, where the
          handoff puts it. It is a claim about every number on this screen, so
          it belongs beside the search rather than buried under one section.
        */}
        <p className="af-pf-rail-foot af-pf-d-only">{t.railFoot}</p>
      </aside>

      <section className="af-pf-main" aria-label={t.mainLabel}>
        {/* ── Game day home: your flagged starters, before any search ──── */}
        {/* Pick the leagues the finder reads — only on the all-leagues home; a held league is the switcher's. */}
        {!detail && signedIn && !selectedLeagueId && pickLeagues.length > 1 ? <LeaguePicker leagues={pickLeagues} saved={savedPicks} /> : null}
        {!detail && signedIn && triage ? <GameDayTriage state={triage} nowIso={nowIso} leagueCount={leagueCount} /> : null}
        {!detail && signedIn && shares ? <PlayerSharesBoard state={shares} league={leagueShares} valuesLocked={depthLocked} /> : null}

        {/* ── The league in context: who has him HERE ─────────────────── */}
        {detail && leagueView ? <LeagueOwnershipCard view={leagueView} playerName={detail.player.name} /> : null}
        {/* Phones: the same next move, pinned above the tab bar once the card's buttons scroll away. */}
        {detail && leagueView ? <StickyActionBar view={leagueView} playerName={detail.player.name} /> : null}
        {/* The trade visual, under the ownership card, when someone else has him here. */}
        {detail && leagueView?.ownership.kind === 'other' && depthAccess && depthLocked ? (
          <CoreDepthLock access={depthAccess} what={`Trading for ${detail.player.name}`} />
        ) : detail && leagueView?.ownership.kind === 'other' && tradeVisual ? (
          <CoreDepthGate access={depthAccess}>
            <TradeVisual state={tradeVisual} playerName={detail.player.name} />
          </CoreDepthGate>
        ) : null}

        {detail && compareRequested && depthAccess && depthLocked ? (
          <CoreDepthLock access={depthAccess} what="Side-by-side compare" />
        ) : null}

        {/* ── Detail ────────────────────────────────────────────────── */}
        {detail && compare ? (
          <CoreDepthGate access={depthAccess}>
            <PlayerCompare
              a={detail}
              b={compare}
              query={query}
              selectedLeagueId={selectedLeagueId ?? null}
              signedIn={signedIn}
              swapHref={swapHref}
              clearHref={clearHref}
            />
          </CoreDepthGate>
        ) : detail ? (
          <section className="af-card af-pf-detail">
            <header className="af-pf-detail-head">
              <Headshot src={headshotFor(detail.player)} name={detail.player.name} />

              <div className="af-pf-identity">
                <div className="af-pf-name-row">
                  <h2 className="af-display af-pf-name">{detail.player.name}</h2>
                  {/*
                    Readiness, from the injury feed. No row means no chip — the
                    injury section below says "no designation on file", which is
                    not the same claim as READY.
                  */}
                  {ready ? (
                    <span className="af-chip af-num af-pf-ready" data-tone={ready.tone}>
                      {designationText(ready.label, language)}
                      {detail.injury.available &&
                      detail.injury.data.description &&
                      detail.injury.data.description.length <= 28
                        ? ` · ${detail.injury.data.description}`
                        : ''}
                    </span>
                  ) : null}
                  {/* Which way the designation is moving, and ESPN's estimated return (injuryTimeline.ts). */}
                  {ready ? <InjuryTimelineChip timeline={detail.injuryTimeline} /> : null}
                  {/* Not playing this week — beside readiness, since a Ready player on bye still scores nothing. */}
                  {byeMark ? (
                    <span className="af-chip af-num af-pf-ready af-pf-bye" data-tone={byeMark.tone}>
                      {coreUiCopy(byeMark.label, language)}
                    </span>
                  ) : null}
                </div>
                <div className="af-pf-line">
                  {detail.player.position ?? ''}
                  {detail.player.team ? (
                    <>
                      {detail.player.position ? ' · ' : ''}
                      <TeamLogo sport={detail.player.sport} team={detail.player.team} size={18} />
                      {detail.player.team}
                    </>
                  ) : null}
                  {detail.player.number != null
                    ? `${detail.player.position || detail.player.team ? ' · ' : ''}#${detail.player.number}`
                    : ''}
                  {leagueMode ? (
                    <span className="af-pf-rostered">
                      {' · '}
                      {leagueView ? t.inLeague(leagueView.leagueName) : t.inThisLeague}
                      {' · '}
                      <Link href={allLeaguesHref} className="af-pf-all-leagues">
                        {t.allLeaguesLink}
                      </Link>
                    </span>
                  ) : signedIn && detail.leagues.available ? (
                    <span className="af-pf-rostered">
                      {' · '}
                      {yoursCount > 0
                        ? t.onLeagues(
                            yoursCount,
                            leagueCount,
                            detail.player.platforms.length > 0 ? listPlatforms(detail.player.platforms, language) : null,
                          )
                        : t.notOnAny(leagueCount)}
                      {leagueRows.some((r) => !r.slot.isYours)
                        ? t.rosteredByOthers(leagueRows.filter((r) => !r.slot.isYours).length)
                        : ''}
                    </span>
                  ) : !signedIn ? (
                    <span className="af-pf-rostered">{t.signInAcross}</span>
                  ) : (
                    <span className="af-pf-rostered">{t.crossLeagueUnavailable}</span>
                  )}
                </div>
                <LeagueStrip chips={stripChips} leagueHref={stripLeagueHref} />
              </div>

              <span className="af-sync af-num" data-stale={detail.freshness.stale}>
                {detail.freshness.stale ? '⚠ ' : ''}
                {ageText(detail.freshness.label, language)}
              </span>
            </header>

            {/* Game day: at-risk or out, with a kickoff on the schedule — the lock and the lineup buttons first. */}
            {signedIn && ((gameDayStatus && detail.game?.available) || (byeMark && !detail.game?.available)) ? (
              <GameDayBanner
                playerName={detail.player.name}
                status={gameDayStatus ?? (byeMark ? ready : null)}
                detail={detail.injury.available && detail.injury.data.description && detail.injury.data.description.length <= 28 ? detail.injury.data.description : null}
                reportedAt={injuryReportedAt}
                game={detail.game?.available ? detail.game.data : null}
                bye={detail.game?.available ? null : byeMark}
                inactive={inactive}
                nowIso={nowIso}
                starting={startingLeagues}
                benched={benchedCount}
                elsewhere={elsewhereCount}
              />
            ) : null}

            {/* Live or final: his game this week and his points in your leagues, as each platform scored them. */}
            <LiveGameBadge data={liveGame} nowIso={nowIso} />

            {/* Compare: a second name beside this one. Suggestions link to ?vs= (2026-09-06). */}
            {detailRef ? (
              <div className="af-pf-compare-entry">
                <span className="af-label">{t.compareWith}</span>
                <PlayerSearchBox query={query} selectedLeagueId={selectedLeagueId ?? null} signedIn={signedIn} variant="compare" compareWith={detailRef} />
              </div>
            ) : null}

            {/* Stat tiles — a missing one says why rather than showing a bare dash */}
            <div className="af-pf-tiles af-pf-d-only">
              {/*
                ⚠ "STANDARD SCORING" IS SAID OUT LOUD BECAUSE THE FEED IS NOT
                LEAGUE-SPECIFIC. This screen spans every league the user is in, and
                the same player is worth different points in each. The per-league
                number is in the table below; this tile is the one feed number.
              */}
              {/*
                In league mode both tiles switch to the league's own scoring
                (Guap, 2026-09-02). Standard scoring is the cross-league number.
              */}
              {leagueProj ? (
                <StatTile
                  label={leagueProj.available ? t.projWeek(leagueProj.data.week) : t.projThisWeek}
                  state={leagueProj}
                  value={leagueProj.available ? leagueProj.data.points.toFixed(1) : null}
                  tone="good"
                  tip={{ title: t.projectionTitle, body: t.projectionLeagueBody }}
                  help={leagueProj.available ? t.leagueScoringOf(leagueView?.leagueName ?? null) : undefined}
                  why={why}
                />
              ) : (
                <StatTile
                  label={detail.projection.available ? t.projWeek(detail.projection.data.week) : t.projThisWeek}
                  state={detail.projection}
                  value={detail.projection.available ? detail.projection.data.points.toFixed(1) : null}
                  tone="good"
                  tip={{ title: t.projectionTitle, body: t.projectionStandardBody }}
                  help={detail.projection.available ? t.standardScoringSeason(detail.projection.data.season) : undefined}
                  why={why}
                />
              )}
              {/*
                AllFantasy's own projection, beside the provider's. In league mode it is carried into
                this league's scoring; across leagues it is the engine's standard-scoring number, like
                the tile beside it.
              */}
              {detail.afProjection ? (
                <StatTile
                  label={detail.afProjection.available ? t.afProjWeek(detail.afProjection.data.week) : t.afProj}
                  state={detail.afProjection}
                  value={afTile != null ? afTile.toFixed(1) : null}
                  tone="good"
                  tip={{ title: t.afTitle, body: leagueProj ? t.afLeagueBody : t.afStandardBody }}
                  help={detail.afProjection.available ? (leagueProj ? t.thisLeagueScoring : t.standardScoring) : undefined}
                  why={why}
                />
              ) : null}
              {leagueRank ? (
                <StatTile
                  label={t.posRank}
                  state={leagueRank}
                  value={leagueRank.available ? `${leagueRank.data.position}${leagueRank.data.rank}` : null}
                  tone="warn"
                  help={leagueRank.available ? t.ofPricedHere(leagueRank.data.outOf, leagueRank.data.position) : undefined}
                  why={why}
                />
              ) : (
                <StatTile
                  label={t.posRank}
                  state={detail.positionRank}
                  value={
                    detail.positionRank.available
                      ? `${detail.positionRank.data.position}${detail.positionRank.data.rank}`
                      : null
                  }
                  tone="warn"
                  // The denominator lives here rather than in the value so the tile
                  // reads "WR12 / of 143 projected" — a rank AND its universe.
                  help={
                    detail.positionRank.available
                      ? t.ofProjected(detail.positionRank.data.outOf, detail.positionRank.data.position)
                      : undefined
                  }
                  why={why}
                />
              )}
              {/*
                Only rendered when there IS a value. A defender with no cached board entry gets
                no tile rather than an empty one — an unmeasured player and a worthless player
                must not look the same, and "—" beside a value label reads as the latter.

                ⚠ THE REFERENCE LEAGUE IS IN `help`, NOT OPTIONAL DECORATION. "3,284" is a fact
                about a 12-team league starting three defenders, not about the world.
              */}
              {detail.idpValue ? (
                <StatTile
                  label={t.idpValue}
                  value={detail.idpValue.value.toLocaleString()}
                  tone="good"
                  tip={{ title: t.idpValue, body: t.idpBody(detail.idpValue.reference.numTeams, detail.idpValue.reference.idpStarters) }}
                  help={
                    [
                      detail.idpValue.positionRank ? t.idpRank(detail.idpValue.positionRank) : null,
                      t.idpReference(detail.idpValue.reference.numTeams, detail.idpValue.reference.idpStarters),
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                />
              ) : null}
              <StatTile
                label={t.snapShare}
                state={detail.snapShare}
                value={
                  detail.snapShare.available
                    ? `${Math.round(detail.snapShare.data.share * 100)}%`
                    : null
                }
                tip={{ title: t.snapShare, body: t.snapShareBody }}
                help={detail.snapShare.available ? t.snapsHelp(detail.snapShare.data.basis, detail.snapShare.data.games) : undefined}
                why={why}
              />
              <StatTile
                label={t.age}
                value={detail.bio.age != null ? String(detail.bio.age) : null}
                help={detail.bio.age == null ? t.noBirthDate : undefined}
              />
            </div>

            {/* ── Injury ────────────────────────────────────────────── */}
            <section className="af-pf-block af-pf-d-only">
              <h3 className="af-label">{t.injury}</h3>
              {detail.injury.available ? (
                <div className="af-pf-injury">
                  <span className="af-chip af-pf-injury-status">
                    {detail.injury.data.status != null ? designationText(detail.injury.data.status, language) : t.noDesignation}
                  </span>
                  {detail.injury.data.description ? (
                    <p className="af-pf-injury-note">{detail.injury.data.description}</p>
                  ) : null}
                  {/* When the feed said it — the fact that tells a reader the news is fresh enough to act on. */}
                  {reportedLabel(asIso(detail.injury.data.reportedAt), nowIso) ? (
                    <span className="af-pf-injury-when af-num">
                      {coreUiCopy(reportedLabel(asIso(detail.injury.data.reportedAt), nowIso)!, language)}
                    </span>
                  ) : null}
                </div>
              ) : (
                <Unavailable reason={why(detail.injury.reason)} />
              )}
            </section>

            {/* ── Next game + news (Phase 1): every width — the late news IS the game-day story ── */}
            {depth ? <PlayerNextGames next={depth.nextGame} upcoming={depth.upcoming} matchups={matchupOutlook} /> : null}
            {depth ? <PlayerNews state={depth.news} nowIso={nowIso} /> : null}

            {/* ── Every platform, every league ──────────────────────── */}
            {/*
              ⚠ THIS IS THE DECISION TABLE, NOT A REFERENCE LIST. Slot truth beats
              projection: a bench or IR row with a good number is the headline
              problem, and it is coloured as one. Each row carries the league's
              OWN scoring result — never the feed number — and ends in where to
              fix it, or "nothing to do", or "trade for him" when someone else
              has him.
            */}
            <section className="af-pf-block af-pf-leagues" aria-labelledby="af-pf-leagues-h">
              <header className="af-pf-block-head">
                <h3 className="af-pf-h3" id="af-pf-leagues-h">
                  {leagueMode ? t.inThisLeagueHeading : t.everyLeagueHeading}
                </h3>
                {/* Beside the h3, not in it (aria-labelledby). Replaces the column titles a phone never showed. */}
                <TopicTip topic="leagueTableColumns" />
                <p className="af-pf-block-sub">
                  {leagueMode ? (
                    <>
                      {t.slotStatusHere}{' '}
                      <Link href={allLeaguesHref} className="af-pf-all-leagues">
                        {t.allLeaguesLink}
                      </Link>
                    </>
                  ) : (
                    t.slotStatusNow
                  )}
                </p>
              </header>
              {/*
                ⚠ SIGNED OUT, "AVAILABLE WITH ZERO ROWS" IS NOT AN ANSWER. The
                loader is handed an empty league list and correctly returns an
                empty array marked available — but rendering that as "he is not
                rostered in any league you have connected" tells a stranger a
                fact about leagues they do not have. The signed-out branch is
                checked first for that reason.
              */}
              {!signedIn ? (
                <>
                  <Unavailable reason={t.signInReason} />
                  <Link href="/signup" className="af-btn af-pf-signin">
                    {t.connectLeague}
                  </Link>
                </>
              ) : detail.leagues.available ? (
                leagueRows.length === 0 ? (
                  <p className="af-pf-unavailable">
                    {leagueMode ? t.notOnRosterHere : t.notOnAnyRoster(leagueCount)}
                  </p>
                ) : (
                  <table className="af-pf-table">
                    <thead>
                      <tr>
                        <th className="af-label">{t.colLeague}</th>
                        <th className="af-label">{t.colSlot}</th>
                        <th className="af-label af-pf-col-status">{t.colStatus}</th>
                        <th className="af-label af-pf-col-proj">{t.colProj}</th>
                        <th className="af-label af-pf-col-proj af-pf-col-af">AF</th>
                        {leagueValues ? <th className="af-label af-pf-col-value">{t.colValue}</th> : null}
                        <th className="af-label" />
                      </tr>
                    </thead>
                    <tbody>
                      {leagueRows.map((r) => {
                        const l = r.slot
                        const tone = rowTone(r)
                        return (
                          <tr key={l.leagueId} data-tone={tone} data-held={r.held}>
                            <td className="af-pf-col-league">
                              <Link href={`/core?league=${encodeURIComponent(l.leagueId)}`} className="af-pf-league-name">
                                {l.leagueName}
                              </Link>
                              <span className="af-pf-league-meta">
                                <span className="af-platform af-platform-chip af-pfind-platform" data-platform={l.platform}>
                                  {l.platform}
                                </span>
                                {l.format ? <span>{l.format}</span> : null}
                                {!l.isYours ? (
                                  <span className="af-pf-owner">
                                    {l.owner
                                      ? t.rosteredBy(l.owner.ownerName ? `@${l.owner.ownerName}` : l.owner.teamName)
                                      : t.rosteredByAnother}
                                  </span>
                                ) : null}
                                {r.held ? <span className="af-pf-impact-held af-label">{t.thisLeagueBadge}</span> : null}
                                {/* The phone table has no room for a Value column; the number rides in the league cell there. */}
                                {leagueValues?.[l.leagueId] ? (
                                  <span className="af-pf-value-inline af-num">{t.valueInline(leagueValues[l.leagueId]!.value.toLocaleString('en-US'))}</span>
                                ) : null}
                              </span>
                            </td>
                            <td className="af-pf-col-slot">
                              <span className="af-chip af-num af-pf-slot" data-tone={slotTone(l.slot, r.move)}>
                                {slotText(r.impact?.exactSlot ?? l.slot, language)}
                              </span>
                              {r.impact && !r.impact.slotConfirmed ? (
                                <span className="af-pf-impact-unconfirmed">{t.slotUnconfirmed}</span>
                              ) : null}
                              {/* The lineup lock, on every league where he is yours — a bench player can still be moved in. */}
                              {l.isYours && gameKickoff ? <LockClock kickoffIso={gameKickoff} nowIso={nowIso} /> : null}
                            </td>
                            <td className="af-pf-col-status">
                              {l.isYours && ready ? (
                                <span className="af-pf-status af-num" data-tone={ready.tone}>
                                  {designationText(ready.label, language)}
                                </span>
                              ) : (
                                <span className="af-pf-nothing">—</span>
                              )}
                            </td>
                            <td className="af-pf-col-proj">
                              {l.isYours && r.impact?.afPoints.available ? (
                                <span className="af-pf-proj af-num">
                                  {r.impact.afPoints.data.points.toFixed(1)}
                                </span>
                              ) : (
                                <span
                                  className="af-pf-nothing"
                                  title={l.isYours && r.impact && !r.impact.afPoints.available ? why(r.impact.afPoints.reason) : undefined}
                                >
                                  —
                                </span>
                              )}
                            </td>
                            <td className="af-pf-col-proj af-pf-col-af">
                              {(() => {
                                // Only where the provider figure beside it is priced — the carry needs it.
                                const af =
                                  l.isYours && r.impact?.afPoints.available ? afIn(r.impact.afPoints.data.points) : null
                                return af != null ? (
                                  <span className="af-pf-proj af-pf-af af-num">
                                    {af.toFixed(1)}
                                  </span>
                                ) : (
                                  <span className="af-pf-nothing">—</span>
                                )
                              })()}
                            </td>
                            {leagueValues ? (
                              <td className="af-pf-col-value">
                                {leagueValues[l.leagueId] ? (
                                  <span
                                    className="af-pf-value af-num"
                                    title={
                                      leagueValues[l.leagueId]!.fitNote != null
                                        ? why(leagueValues[l.leagueId]!.fitNote!)
                                        : t.valueBasis(leagueValues[l.leagueId]!.mode, leagueValues[l.leagueId]!.numQbs === 2)
                                    }
                                  >
                                    {leagueValues[l.leagueId]!.value.toLocaleString('en-US')}
                                    {leagueValues[l.leagueId]!.value !== leagueValues[l.leagueId]!.base ? <span className="af-pf-value-fit" aria-label={t.valueAdjusted}>*</span> : null}
                                  </span>
                                ) : (
                                  <span className="af-pf-nothing">—</span>
                                )}
                              </td>
                            ) : null}
                            <td className="af-pf-table-action">{rowAction(r, last, t, language)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                <Unavailable reason={gatedReason(detail.leagues)} />
              )}
              {signedIn && detail.leagues.available && leagueRows.some((r) => r.slot.isYours) && !detail.impact.available ? (
                <p className="af-pf-unavailable">{why(detail.impact.reason)}</p>
              ) : null}
              {/*
                Leagues whose rosters do not speak Sleeper ids are named, not
                silently absent — their absence would otherwise read as "not
                rostered there", which is a claim we cannot make.
              */}
              {signedIn && unmatched.length > 0 ? (
                <p className="af-pf-unavailable af-pf-unmatched">
                  {t.notChecked(
                    unmatched.map((u) => u.leagueName),
                    [...new Set(unmatched.map((u) => platformLabel(u.platform)))].join(` ${t.and} `),
                  )}
                </p>
              ) : null}
            </section>

            {/*
              ── Available in your leagues ──: every league where he is a free agent, with where to
              claim him (free) and a suggested FAAB bid (AF Pro, withheld server-side when locked).
            */}
            {signedIn ? <FreeAgentBids data={freeAgentBids} playerName={detail.player.name} access={depthAccess} /> : null}

            {/* ── Market value, last 30 days ──: facts free; the buy-low / sell-high call is AF Pro. */}
            <ValueTrend data={valueTrend} access={depthAccess} />

            {/* ── Next man up ──: his depth chart, and where each player around him is in your leagues (free). */}
            <DepthChartBackups
              data={depthChart}
              playerName={detail.player.name}
              hrefFor={(ref, name) => `/core/players?q=${encodeURIComponent(name)}&player=${encodeURIComponent(ref)}${leagueParam}`}
            />

            {/* ── Who'd start him ──: the sell side where he is yours (AF Pro, withheld server-side when locked). */}
            {signedIn ? <WhoStartsHim data={whoStartsHim} playerName={detail.player.name} access={depthAccess} /> : null}

            {/* ── This season: projected against scored, week by week (Phase 1) ── */}
            {depth ? <PlayerSeasonCard state={depth.season} name={detail.player.name} /> : null}

            {/* ── Recommended moves ─────────────────────────────────── */}
            {signedIn ? (
              <div className="af-pf-d-only">
                <CoreDepthGate access={depthAccess} what="Recommended moves">
                  <RecommendedMoves
                    moves={moves}
                    emptyReason={
                      !detail.impact.available
                        ? detail.impact.reason
                        : impactRows.length === 0
                          ? 'He is not on any of your rosters, so there is no lineup to fix.'
                          : null
                    }
                  />
                </CoreDepthGate>
              </div>
            ) : null}

            {/* ── Season stats ──────────────────────────────────────── */}
            <section className="af-pf-block af-pf-d-only">
              <h3 className="af-label">{t.seasonStatistics}</h3>
              {detail.seasonStats.available ? (
                <ul className="af-pf-seasons">
                  {detail.seasonStats.data.map((s) => (
                    <li key={s.season} className="af-pf-season">
                      <span className="af-num af-pf-season-year">{s.season}</span>
                      <span className="af-pf-season-stats">
                        {Object.entries(s.stats)
                          .slice(0, 6)
                          .map(([k, v]) => `${k} ${v}`)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Unavailable reason={why(detail.seasonStats.reason)} />
              )}
            </section>
          </section>
        ) : (
          <section className="af-card af-pf-detail af-pf-detail--empty">
            <p className="af-pf-unavailable">{t.pickAMatch}</p>
          </section>
        )}
      </section>

      {/*
        The decision column. It renders only when there is a resolved player AND
        real per-league impact behind it — an empty rail of headed cards would
        imply we looked and found nothing, which is different from not looking.
      */}
      {/*
        Locked (player depth is AF Pro): the column holds the lock instead. Its data — presence and
        windows — was never loaded; the verdict and the swaps are drawn from the impact rows the
        free table already shows, so for them the lock is the whole of the gate.
      */}
      {detail && depthAccess && depthLocked && signedIn ? (
        <aside className="af-pf-side" aria-label={t.sideLabel}>
          <CoreDepthLock access={depthAccess} what="The verdict, bench swaps and trade windows" />
        </aside>
      ) : detail && (impactRows.length > 0 || presence || (windows && windows.length > 0)) ? (
        <aside className="af-pf-side" aria-label={t.sideLabel}>
          {depthAccess ? <FreeUntilNote access={depthAccess} /> : null}
          {impactRows.length > 0 ? (
            <PlayerVerdict
              playerName={detail.player.name}
              impact={impactRows}
              moves={moves}
              scope={leagueMode ? 'league' : 'all'}
            />
          ) : null}
          {/*
            One computed call per league (Phase 3): sit / start / hold / locked, the reason it rests on,
            "Swap now" in an AllFantasy league, and Ask Chimmy scoped to that league. Best-ball leagues
            have no lineup decision and are left out.
          */}
          {impactRows.length > 0 && detail.player.sleeperId ? (
            <LeagueCalls
              playerName={detail.player.name}
              calls={impactRows
                .filter((i) => !leagueRows.some((r) => r.slot.leagueId === i.leagueId && r.slot.bestBall))
                .map((i) =>
                  leagueCall({
                    impact: i,
                    player: { sleeperId: detail.player.sleeperId!, name: detail.player.name, team: detail.player.team },
                    readinessTone: ready?.tone ?? null,
                    kickoffs: detail.kickoffs ?? {},
                    nowIso,
                  }),
                )}
            />
          ) : null}
          {/*
            The trade window: who to pitch and when they move. Grade it jumps to
            the trade visual when it is on the screen (someone else has him in
            the held league), else opens the Trade Center for that league.
          */}
          {/* Core view with him on other people's rosters: every owner, most reachable first. */}
          {!leagueMode && windows && windows.length > 0 ? (
            <TradeWindows presences={windows} playerName={detail.player.name} pkg={pitchPackage} nowIso={nowIso} unread={windowsUnread} />
          ) : presence ? (
            <TradeWindow
              state={presence}
              playerName={detail.player.name}
              pkg={pitchPackage}
              gradeHref={tradeVisual?.available && leagueView?.ownership.kind === 'other' ? '#af-pf-tv-h' : null}
              tradeCenterHref={
                presence.available
                  ? `/core/trades?league=${presence.data.leagueId}`
                  : selectedLeagueId
                    ? `/core/trades?league=${selectedLeagueId}`
                    : '/core/trades'
              }
              nowIso={nowIso}
            />
          ) : null}
          <SwapCandidates impact={impactRows} kickoffs={detail.kickoffs ?? {}} nowIso={nowIso} />
        </aside>
      ) : null}
    </div>
  )
}

export default PlayerFinder
