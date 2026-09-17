'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'
import type { SourceScreenLink } from '@/lib/league-links/sourceLinkResolver'
import type { CrossLeagueValueAction } from '@/lib/core-app/crossLeagueValueActions'
import {
  RosterPlayerRow,
  StockMark,
  TradeAssetPicker,
  type PickedAsset,
} from '@/components/core-app/screens/TradeAssetPicker'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
import {
  analysisUnpricedReason,
  pickUnpricedReason,
  pricedOnAnalysisReason,
} from '@/lib/trade-value/unpricedReason'
/*
 * ⚠ THE SAME RESOLVER THE PICKER USES, DELIBERATELY. This repo already carries FIVE
 * team-logo functions (`getTeamLogo`, three separate `getTeamLogoUrl`s, and
 * `getTeamLogoCandidates`); a sixth spelling of the rule is the last thing it needs. The
 * picker calls this one, so the logo beside a player in the builder is the same asset as
 * the logo beside him in the list he was picked from.
 */
import { resolveTeamLogoUrlSync } from '@/lib/draft-sports-models/player-asset-resolver'
import { TradeInbox } from '@/components/core-app/screens/TradeInbox'
import { TradeProposePanel } from '@/components/core-app/screens/TradeProposePanel'
import { useLeagueRosters } from '@/components/core-app/screens/useLeagueRosters'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { projectedLetterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'
import { TradeFinderPanel } from '@/components/core-app/screens/TradeFinderPanel'
import { TradeLeagueStrip, type StripLeague } from '@/components/core-app/screens/TradeLeagueStrip'
import { TradeAssetSheet, usePhoneViewport } from '@/components/core-app/screens/TradeAssetSheet'
import {
  TradePartnerSuggestions,
  suggestionToPickedAssets,
} from '@/components/core-app/screens/TradePartnerSuggestions'
import type { PartnerRecommendation } from '@/lib/trade-intel/partnerRanking'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-trade-center.css'

/**
 * Screen 36a — Trade Center.
 *
 * Build a deal, get the fairness verdict, and see the advisory context beside
 * it. Replaces the fragmented trade-analyzer / evaluator / finder surfaces with
 * one page.
 *
 * ⚠ THE THREE STATES ARE ORGANIC, NOT A PREVIEW SWITCHER. The design ships a
 * five-way state toggle so a reviewer can see every layout; in production those
 * are situations the same page falls into on its own — a normal analysis, a
 * degraded one, and a format that forbids the deal outright. The switcher is
 * deliberately not reimplemented.
 *
 * ⚠ MULTI-TEAM AND CROSS-PLATFORM ARE NOT BUILT. The handoff is explicit that
 * neither has backing schema: 3+ teams needs the two-sided
 * `sideGive`/`sideGet` input replaced with a per-team shape AND a real answer
 * for how fairness generalises past two sides, and a linked deal needs a
 * `LinkedTradeProposal` record with a status machine, because no platform can
 * enforce the other leg. Rendering either now would be a UI promising a
 * transaction the system cannot make.
 *
 * ⚠ NO NEW API ROUTE. This posts to the existing `/api/trade-value/analyze`.
 * The repo sits at the platform's route ceiling and a page is not worth one.
 *
 * VISUAL UPGRADE (design-refs/trade-center-handoff, Core artboard): a
 * cross-league offers strip above the context bar, platform marks wherever a
 * league is named, a league-aware asset legend, position colour on the position
 * token, a value-balance rail under the builder, the verdict as the hero with
 * a two-ended balance track, and the contender / rebuilder reads the engine
 * already returned but this page never rendered.
 */

/** Asset vocabulary the legend documents, per the handoff. */
const ASSET_TYPES: Array<{ key: string; label: string; glyph: string; color: string }> = [
  { key: 'player', label: 'Player · any position, incl. IDP', glyph: 'P', color: '#22d3ee' },
  { key: 'pick', label: 'Pick', glyph: 'D', color: '#8f97bd' },
  { key: 'faab', label: 'FAAB', glyph: '$', color: '#34d399' },
  { key: 'idol', label: 'Idol · Survivor', glyph: 'I', color: '#fbbf24' },
  { key: 'weapon', label: 'Weapon · Zombie', glyph: 'W', color: '#fb5b78' },
  { key: 'serum', label: 'Serum · Zombie', glyph: 'S', color: '#a78bfa' },
]

/**
 * Which of those classes THIS league can trade.
 *
 * The legend used to list all six everywhere, so a redraft league advertised
 * future picks — the very asset the format banner then refuses. Keyed on the
 * resolved league type (`resolveLeagueCardTypeKey`) and the raw variant, never
 * on a display string. Unknown type → the full vocabulary, because "we do not
 * know" must not read as "this league forbids picks".
 */
function assetTypesFor(
  leagueType: string | null | undefined,
  leagueVariant: string | null | undefined,
): { types: typeof ASSET_TYPES; scoped: boolean } {
  const type = (leagueType ?? '').toLowerCase()
  const variant = (leagueVariant ?? '').toLowerCase()
  if (!type && !variant) return { types: ASSET_TYPES, scoped: false }

  const keys = new Set<string>(['player', 'faab'])
  /* Picks exist only where there is a future draft to send them into. */
  if (type === 'dynasty' || type === 'keeper') keys.add('pick')
  if (variant === 'zombie') {
    keys.add('weapon')
    keys.add('serum')
  }
  if (variant === 'survivor') keys.add('idol')
  return { types: ASSET_TYPES.filter((a) => keys.has(a.key)), scoped: true }
}

/** Single letter for a platform mark, matching the rail's PLATFORM_MARK. */
const PLATFORM_MARK: Record<string, string> = {
  sleeper: 'S',
  espn: 'E',
  yahoo: 'Y',
  cbs: 'C',
  mfl: 'M',
  fantrax: 'F',
  fleaflicker: 'L',
}
function platformMark(platform: string): string {
  return PLATFORM_MARK[platform.toLowerCase()] ?? platform.charAt(0).toUpperCase()
}

/**
 * Position colour, the same assignment the league Trades tab uses for its
 * trade-block cards, so a WR reads the same colour on every trade surface.
 */
const POSITION_TONE: Record<string, string> = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  DL: 'dl',
  DE: 'dl',
  DT: 'dl',
  NT: 'dl',
  LB: 'lb',
  DB: 'db',
  CB: 'db',
  S: 'db',
  SS: 'db',
  FS: 'db',
  K: 'k',
  DEF: 'def',
  DST: 'def',
}
function positionTone(position: string): string {
  return POSITION_TONE[position.toUpperCase()] ?? 'other'
}

type Line = {
  name: string
  position?: string | null
  team?: string | null
  marketValue?: number | null
  pricedSource?: string | null
  /** Why `marketValue` is null, in the words printed under the row; absent when priced. */
  unpricedWhy?: string | null
  /** Absent for a searched player, a pick and FAAB — the glyph covers all three. */
  imageUrl?: string | null
  /**
   * ⚠ A PICK HAS NO STOCK AND THAT IS NOT AN OVERSIGHT. `PlayerValueSnapshot` holds players only,
   * and a pick's price comes from a static curve whose anchor is not re-solved on a schedule, so
   * there is no thirty-day movement to report. It renders nothing rather than a fabricated `flat`.
   */
  stock?: 'up' | 'down' | 'flat' | null
  stockDelta?: number | null
}

/**
 * One line of the analysis echo.
 *
 * 🛑 `unpriced` MEANS `marketValue` IS A PLACEHOLDER 0, AND IT WAS BEING SHOWN. The engine's
 * pricer returns 0 with this flag when it finds nothing at all; the builder took the 0 as a price,
 * so a team defense read "0" after Analyze — and was not counted as unpriced.
 */
type EngineLine = Line & { unpriced?: boolean; sport?: string | null }

type AnalyzeResult = {
  labels?: { fairnessLabel?: string; confidenceLabel?: string }
  fairnessScore?: number
  confidenceScore?: number
  percentDiff?: number
  degraded?: boolean
  dataGaps?: string[]
  giveTotal?: number
  getTotal?: number
  players?: { give: EngineLine[]; get: EngineLine[] }
  byeNotes?: string[]
  needNotes?: string[]
  leverageNotes?: string[]
  postureNotes?: string[]
  pickNotes?: string[]
  scaleNotes?: string[]
  formatNotes?: string[]
  tradeIntelligence?: {
    whoWinsNow?: string
    whoWinsLongTerm?: string
    contenderRecommendation?: string
    rebuilderRecommendation?: string
    tradeWarnings?: string[]
    rebalanceSuggestions?: string[]
    alternateTargets?: Array<{ name: string; marketValue: number; position: string | null }>
    alternateTargetsNote?: string
    why?: string
  }
}

/**
 * ⚠ AN UNPRICED ASSET IS AN EM DASH, NEVER A ZERO. A defender the market feed
 * cannot price is not worthless, and rendering 0 would say he is.
 */
function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : '—'
}

/** Sum that ignores unpriced lines rather than treating them as zero. */
function totalOf(lines: Line[]): string {
  const priced = lines
    .map((l) => l.marketValue)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (priced.length === 0) return '—'
  return priced.reduce((a, b) => a + b, 0).toLocaleString()
}

/** The same sum as a number, null when nothing on the side is priced. */
function pricedTotal(lines: Line[]): number | null {
  const priced = lines
    .map((l) => l.marketValue)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return priced.length === 0 ? null : priced.reduce((a, b) => a + b, 0)
}

function unpricedCount(lines: Line[]): number {
  return lines.filter((l) => l.marketValue == null).length
}

/** A line's asset class, read off the position the builder stamps on it. */
function kindOf(line: Line): 'player' | 'pick' | 'faab' {
  return line.position === 'PICK' ? 'pick' : line.position === 'FAAB' ? 'faab' : 'player'
}

function glyphFor(line: Line): { glyph: string; color: string } {
  const t = ASSET_TYPES.find((a) => a.key === kindOf(line)) ?? ASSET_TYPES[0]!
  return { glyph: t.glyph, color: t.color }
}

const NOTE_GROUPS: Array<{ key: keyof AnalyzeResult; tone: string; title: string }> = [
  /* Format notes lead the page as a banner when they BLOCK the deal; when they
     only describe it (a zombie league's trading rules) they are context. */
  { key: 'formatNotes', tone: 'format', title: 'Format' },
  { key: 'scaleNotes', tone: 'scale', title: 'League & roster shape' },
  { key: 'postureNotes', tone: 'posture', title: 'Where each side stands' },
  { key: 'pickNotes', tone: 'pick', title: 'What these picks really are' },
  { key: 'leverageNotes', tone: 'leverage', title: 'Your leverage' },
  { key: 'needNotes', tone: 'need', title: "What it's worth to you" },
  { key: 'byeNotes', tone: 'bye', title: 'Bye-week collisions' },
]

function AllLeaguesTradeHub(props: {
  leagues: StripLeague[]
  valueActions: CrossLeagueValueAction[]
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visibleLeagues = needle
    ? props.leagues.filter((league) => `${league.name} ${league.platform} ${league.meta ?? ''}`.toLowerCase().includes(needle))
    : props.leagues

  return (
    <div className="af-tc af-tc--hub">
      <header className="af-tc-head af-tc-hub-head">
        <div className="af-label">Core · Trades</div>
        <h1>Trade command center</h1>
        <p className="af-tc-lede">See what needs attention across your leagues, then open one league to review, counter or build a deal.</p>
      </header>

      <TradeLeagueStrip leagues={props.leagues} activeLeagueId={null} />

      {props.valueActions.length > 0 ? (
        <section className="af-tc-hub-actions">
          <div className="af-tc-hub-section-head">
            <div>
              <div className="af-label">Market moves affecting your teams</div>
              <h2>Turn value changes into actions</h2>
            </div>
            <span>{props.valueActions.length} players moved</span>
          </div>
          <div className="af-tc-value-action-list">
            {props.valueActions.slice(0, 6).map((player) => (
              <article key={player.playerId} className="af-tc-value-action" data-direction={player.stock}>
                {player.imageUrl ? <img src={player.imageUrl} alt="" width={32} height={32} /> : <span className="af-tc-glyph">{player.position?.slice(0, 1) ?? 'P'}</span>}
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.position ?? 'Player'} · {player.stock === 'up' ? `up ${money(Math.abs(player.stockDelta ?? 0))}` : `down ${money(Math.abs(player.stockDelta ?? 0))}`} over 30 days</span>
                  <span className="af-tc-value-leagues">
                    {player.affectedLeagues.map((league, index) => (
                      <span key={league.id}>{index > 0 ? ' · ' : ''}<Link href={`/core/trades?league=${encodeURIComponent(league.id)}`}>{league.name}</Link></span>
                    ))}
                  </span>
                </div>
                <b>{player.advice}</b>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="af-tc-hub-leagues">
        <div className="af-tc-hub-section-head">
          <div>
            <div className="af-label">All connected leagues</div>
            <h2>Choose where you want to trade</h2>
          </div>
          <label className="af-tc-hub-search">
            <span className="af-sr-only">Search leagues</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search league or platform" />
          </label>
        </div>
        <div className="af-tc-hub-league-grid">
          {visibleLeagues.map((league) => (
            <Link key={league.id} href={`/core/trades?league=${encodeURIComponent(league.id)}`} className="af-tc-hub-league">
              <span className="af-tc-mark af-platform" data-platform={league.platform.toLowerCase()} aria-hidden>{league.mark}</span>
              <span><strong>{league.name}</strong><small>{league.platform}{league.meta ? ` · ${league.meta}` : ''}</small></span>
              <b aria-hidden>→</b>
            </Link>
          ))}
        </div>
        {visibleLeagues.length === 0 ? <p className="af-tc-timeline-empty">No connected league matches that search.</p> : null}
      </section>
    </div>
  )
}

/**
 * Into the shape `TradeConsoleAnalyzeInput` accepts.
 *
 * ⚠ A PLAYER WITHOUT AN ID GOES BY NAME, which is what the engine's own schema
 * allows — the FantasyCalc search path returns no id, so requiring one would
 * make the most common search result unusable.
 */
/**
 * The phone builder's three steps.
 *
 * ── WHY STEPS, AND WHY ONLY ON A PHONE ───────────────────────────────────────────────────────────
 *
 * At 390px the two team cards stack, each with its own roster list, so "what am I sending" and
 * "what am I getting" sit several screens apart and the verdict is further still. One team per step
 * keeps the deal on one screen at a time; the review step puts both sides and the verdict together.
 *
 * ⚠ CSS DOES THE HIDING, NOT CONDITIONAL RENDERING. Every section stays mounted and is tagged with
 * the steps it belongs to (`data-mstep`), and the stylesheet hides the rest only below 720px. So a
 * desktop render is byte-for-byte the page it was, a rotate or resize never loses picker or
 * analyser state, and nothing depends on knowing the viewport before hydration.
 */
export type MobileStep = 'give' | 'get' | 'review'

const MOBILE_STEPS: Array<{ key: MobileStep; label: string }> = [
  { key: 'give', label: 'You send' },
  { key: 'get', label: 'You get' },
  { key: 'review', label: 'Review' },
]

function toInput(a: PickedAsset) {
  if (a.kind === 'player') {
    return {
      kind: 'player' as const,
      ...(a.playerId ? { playerId: a.playerId } : {}),
      name: a.name,
      ...(a.sportHint ? { sportHint: a.sportHint } : {}),
    }
  }
  if (a.kind === 'pick') {
    return { kind: 'pick' as const, year: a.year, round: a.round, label: a.label }
  }
  return { kind: 'faab' as const, amount: a.amount }
}

export function TradeCenter(props: {
  league: { id: string; name: string; format: string | null; teamCount: number | null } | null
  /** Opponent label, when the caller knows one. */
  opponentLabel?: string | null
  deadlineLabel?: string | null
  /** Source platform id (sleeper, espn, …) — drives the platform marks. */
  platform?: string | null
  /** Resolved league type key (redraft, dynasty, keeper, …) — scopes the asset legend. */
  leagueType?: string | null
  /** Raw `League.leagueVariant` (zombie, survivor, …) — adds that format's asset classes. */
  leagueVariant?: string | null
  /** Every connected league, for the cross-league offers strip. Omit to hide the strip. */
  leagues?: StripLeague[] | null
  /** Portfolio-wide value changes, already scoped to rosters owned by this manager. */
  valueActions?: CrossLeagueValueAction[] | null
  /**
   * Where to actually send the finished trade — the platform's own trade page.
   * Null for a native league, or when the resolver could not verify a host.
   */
  sourceLink?: SourceScreenLink | null
}) {
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The deal under construction, which is the source of truth for what gets
   * analysed. The engine's echo of it (`result.players`) is used only for the
   * prices it resolved — a line the manager added must not disappear because
   * the feed could not price it.
   */
  const [giveAssets, setGiveAssets] = useState<PickedAsset[]>([])
  const [getAssets, setGetAssets] = useState<PickedAsset[]>([])
  const [picking, setPicking] = useState<'give' | 'get' | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  /*
   * Non-null means the next send ANSWERS that offer rather than opening a new one.
   * Held here rather than in the propose panel because the inbox arms it and the
   * panel consumes it, and a value two siblings both need belongs to the parent.
   */
  const [countering, setCountering] = useState<{ tradeId: string; label: string } | null>(null)
  /** Bumped after a send lands, so the inbox refetches what the write changed. */
  const [inboxReloadToken, setInboxReloadToken] = useState(0)

  /* Phone-only step state; see MobileStep. Ignored by the desktop layout. */
  const [mobileStep, setMobileStep] = useState<MobileStep>('give')
  const isPhone = usePhoneViewport()
  const stepAnchorRef = useRef<HTMLDivElement | null>(null)
  /* The "+ Add asset" button that opened the phone sheet — where focus returns on close. */
  const sheetOpenerRef = useRef<HTMLElement | null>(null)

  /**
   * Change step, and bring the step's content into view.
   *
   * ⚠ SCROLLED ONLY ON A PHONE, and only when the anchor is ABOVE the viewport. A step switch
   * changes the page's height under the manager's thumb; without this, choosing "You get" from the
   * sticky bar halfway down a long inbox leaves them looking at the inbox with no sign anything
   * happened. A switch made while the builder is already on screen must not jump the page.
   */
  const goToStep = useCallback((step: MobileStep) => {
    setMobileStep(step)
    const anchor = stepAnchorRef.current
    if (!anchor || typeof window === 'undefined') return
    if (anchor.getBoundingClientRect().top < 0) {
      anchor.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [])

  /*
   * ── Who you are trading with ──────────────────────────────────────────
   *
   * ⚠ THE COUNTERPARTY LAYER IS DEAD WITHOUT THIS. `buildTradeContextNotes`
   * returns no leverage notes at all unless it is handed an
   * `opponentTeamExternalId` — their roster holes, the waiver wire they would
   * replace from, and how they have historically paid for the position all sit
   * behind that one id. An anonymous "Their team" column silently discards half
   * the ledger.
   *
   * It also names the picks each side can actually send, which is what makes a
   * pick proposable rather than only priceable.
   */
  const [partnerRosterId, setPartnerRosterId] = useState<string | null>(null)

  /** The engine's lines, keyed by name, merged onto what was added. */
  const pricedBy = useMemo(() => {
    const m = new Map<string, EngineLine>()
    for (const l of [...(result?.players?.give ?? []), ...(result?.players?.get ?? [])]) {
      m.set(l.name.toLowerCase(), l)
    }
    return m
  }, [result])

  const toLines = useCallback(
    (assets: PickedAsset[]): Line[] =>
      assets.map((a) => {
        if (a.kind === 'player') {
          const engine = pricedBy.get(a.name.toLowerCase())
          /*
           * Engine price wins; the list value is the fallback. An engine line flagged `unpriced`
           * wins too — as "no price": its 0 is a placeholder, and the verdict was computed without
           * a real number for him, so showing the list's number would not match it either.
           */
          const marketValue = engine?.unpriced
            ? null
            : (engine?.marketValue ?? a.value ?? null)
          const why =
            marketValue != null
              ? null
              : engine?.unpriced
                ? // The asset's own position first: the engine calls an unmatched player 'UNKNOWN'.
                  analysisUnpricedReason({
                    position: a.position ?? engine.position,
                    sport: a.sportHint ?? engine.sport,
                  })
                : (a.unpricedReason ?? pricedOnAnalysisReason())
          return {
            name: a.name,
            position: a.position,
            team: a.team,
            marketValue,
            unpricedWhy: why?.label ?? null,
            imageUrl: a.imageUrl ?? null,
            stock: a.stock ?? null,
            stockDelta: a.stockDelta ?? null,
          }
        }
        if (a.kind === 'faab') {
          /*
           * FAAB shows the value the ANALYSIS gave it, and nothing before that. User's decision,
           * 2026-09-16 ("yes change FAAB"), replacing "FAAB is deliberately unpriced here".
           *
           * ⚠ ONLY THE ENGINE'S NUMBER, NEVER ONE COMPUTED HERE. The verdict converts FAAB against
           * the league's own budget (`normalizedFaabValue`, which this screen does not know), and
           * the row must show the number the verdict actually used — a client-side conversion would
           * be a second opinion that can disagree with it.
           *
           * 🛑 THE TWO SIDES SPELL THE LINE DIFFERENTLY, which is why nothing ever matched: the
           * analysis names it `FAAB $10`, the builder labels it `$10 FAAB`.
           */
          const engine = pricedBy.get(`faab $${a.amount}`)
          const marketValue = engine && !engine.unpriced ? (engine.marketValue ?? null) : null
          return {
            name: `$${a.amount} FAAB`,
            position: 'FAAB',
            team: null,
            marketValue,
            unpricedWhy: marketValue == null ? pricedOnAnalysisReason().label : null,
          }
        }
        /*
         * 🛑 PRICED HERE, AT RENDER, RATHER THAN TRUSTING WHAT THE ASSET HAPPENS TO CARRY.
         *
         * This field has now been fixed three times in three places — the rosters route,
         * the hand-typed pick, and here — because pricing at PICK time bakes a number into
         * stored state, so every path that creates a pick has to remember to set it. Any
         * path that forgets produces an em dash on the row and "1 unpriced" on a total
         * that then understates itself by a whole first-rounder.
         *
         * The round is all the curve needs and every pick carries one, so deriving it here
         * makes ONE rule serve every path — including a draft serialized into localStorage
         * before the rule existed, which no amount of fixing creation sites can reach.
         *
         * ⚠ A STORED PRICE STILL WINS. The route prices a roster pick against the real
         * slot it projects to; the curve here only knows the round, so it is the fallback
         * and not the override.
         *
         * ⚠ AND A PICK THE ROUTE COULD NOT PLACE STAYS UNPRICED. The picker defaults a missing
         * round to 1 when it builds the asset, so pricing that round here would show a pick with no
         * round as a first-rounder. `unpricedReason` is what survives from the route to say so.
         */
        const pick: Line = {
          name: a.label,
          position: 'PICK',
          team: null,
          marketValue:
            a.value ??
            (!a.unpricedReason && Number.isFinite(a.round) && a.round >= 1
              ? pickValueByOverall({
                  round: a.round,
                  teams: props.league?.teamCount ?? null,
                  firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS,
                })
              : null),
        }
        return {
          ...pick,
          unpricedWhy:
            pick.marketValue == null ? (a.unpricedReason ?? pickUnpricedReason()).label : null,
        }
      }),
    [pricedBy, props.league?.teamCount],
  )

  const give = toLines(giveAssets)
  const get = toLines(getAssets)

  /*
   * 🛑 LOADED AS SOON AS THE LEAGUE IS KNOWN, NOT ONLY ONCE SOMEONE STARTS BUILDING.
   *
   * This used to be gated on `picking !== null || assets.length > 0`, which made the roster list
   * added in the previous commit unreachable: on arrival nothing is picked and nothing is added,
   * so the hook stayed disabled, `rosterData` was null, and the section rendered NOTHING. You had
   * to open the "+ Add asset" modal to make the page show you what a team holds — which is the
   * exact flow that list exists to replace. Measured in the dev server log: a full page load fired
   * nine `trades-panel` reads and ZERO `trades/rosters`.
   *
   * ⚠ THE OLD COMMENT POINTED AT A JUSTIFICATION THAT DOES NOT EXIST. It read "see the hook's own
   * note on why it is lazy"; the hook has no such note. The laziness was presumably to avoid a
   * request on load back when this route resolved players ONCE PER ROSTER — twelve queries for a
   * twelve-team league. That is now one, with the value and stock lookups concurrent, so the cost
   * it was avoiding is largely gone.
   *
   * ⚠ THIS DOES ADD ONE REQUEST PER TRADE-PAGE LOAD, and that is the deliberate trade: it is the
   * request that fetches the content the page is for.
   */
  const { data: rosterData } = useLeagueRosters(
    props.league?.id ?? null,
    Boolean(props.league?.id),
  )
  /*
   * ⚠ IDENTITY, NOT THE PROPOSE GATE. `viewerRosterId` is the engine's strict
   * predicate and is null on every imported league, so filtering "everyone but
   * me" by it filters nothing — and the manager gets offered their own team as
   * a trade partner. `viewerTeamRosterId` is who they are on screen, which is
   * the question being asked here.
   */
  const myRoster =
    rosterData?.rosters.find((r) => r.rosterId === rosterData.viewerTeamRosterId) ?? null
  const partnerRoster = rosterData?.rosters.find((r) => r.rosterId === partnerRosterId) ?? null
  /*
   * ⚠ RANKED WHEN A RANKING ARRIVED, IN ROSTER ORDER OTHERWISE. The chip row lists everyone either
   * way; the ranking only changes who comes first. A team the ranking did not cover keeps its place
   * after the ranked ones rather than disappearing.
   */
  const partnerRanking = rosterData?.partnerRanking ?? null
  const otherRosters = (() => {
    const others = (rosterData?.rosters ?? []).filter((r) => r.rosterId !== rosterData?.viewerTeamRosterId)
    if (!partnerRanking) return others
    const rankOf = new Map(partnerRanking.partners.map((p) => [p.rosterId, p.rank]))
    return others
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (rankOf.get(a.r.rosterId) ?? Infinity) - (rankOf.get(b.r.rosterId) ?? Infinity) || a.i - b.i)
      .map(({ r }) => r)
  })()
  const theirLabel = partnerRoster?.ownerName ?? props.opponentLabel ?? 'Their team'
  const valueActions = props.valueActions ?? []

  const addAsset = useCallback(
    (side: 'give' | 'get', asset: PickedAsset) => {
      const setter = side === 'give' ? setGiveAssets : setGetAssets
      /* Immutable update — never write into the existing array. */
      setter((prev) => [...prev, asset])
      setPicking(null)
    },
    [],
  )

  const removeAsset = useCallback((side: 'give' | 'get', index: number) => {
    const setter = side === 'give' ? setGiveAssets : setGetAssets
    setter((prev) => prev.filter((_, i) => i !== index))
  }, [])

  /**
   * Take a pending offer from the inbox and make it the deal under
   * construction.
   *
   * ⚠ REPLACES, NEVER APPENDS. Merging an incoming offer into whatever was
   * already on the board would produce a deal nobody proposed, and the verdict
   * would be about that invented deal.
   *
   * ⚠ CLEARS THE VERDICT. The score on screen belongs to the previous deal.
   * Leaving it up while the assets change underneath is the one way this page
   * can state something false.
   */
  const loadOffer = useCallback(
    (give: PickedAsset[], get: PickedAsset[], note: string | null) => {
      setGiveAssets(give)
      setGetAssets(get)
      setResult(null)
      setError(null)
      setDraftNote(note ?? 'Offer loaded — analyse it to get a verdict.')
      /*
       * Loading a PROVIDER offer is not answering an AllFantasy one, so it leaves
       * counter mode. Without this, a counter armed a moment ago would still be
       * armed, and the next send would close an offer the manager is no longer
       * looking at.
       */
      setCountering(null)
      /* A loaded offer is a whole deal — on a phone, show both sides of it at once. */
      goToStep('review')
    },
    [goToStep],
  )

  /**
   * Arm counter mode: the builder holds their deal, seen from this manager, and the
   * send goes to `/counter` with the parent attached.
   *
   * ⚠ THE COUNTERPARTY IS SET HERE TOO, deliberately. `TradeProposePanel` sends to
   * whoever the builder has selected; if that still pointed at the last person a
   * manager was browsing, the counter would answer one offer and be addressed to
   * someone else entirely — a wrong trade with no error anywhere.
   */
  const startCounter = useCallback(
    (input: { tradeId: string; give: PickedAsset[]; get: PickedAsset[]; partnerRosterId: string; label: string }) => {
      setGiveAssets(input.give)
      setGetAssets(input.get)
      setResult(null)
      setError(null)
      setPartnerRosterId(input.partnerRosterId)
      setCountering({ tradeId: input.tradeId, label: input.label })
      setDraftNote(`Countering ${input.label} — change it, analyse it, then send it back.`)
      /*
       * A counter starts by CHANGING the deal, and what a manager usually changes is what they ask
       * for — so the phone lands on "You get" rather than on a review of a deal they mean to alter.
       */
      goToStep('get')
    },
    [goToStep],
  )

  /**
   * Put a suggested partner's opening deal in the builder.
   *
   * ⚠ THE SAME CONTRACT AS LOADING AN OFFER: replaces the board, clears the verdict and leaves
   * counter mode — a suggestion is a new deal, not an answer to anyone. The partner is set with it,
   * because the deal only makes sense against that roster.
   *
   * ⚠ AN ASSET THAT CANNOT BE REBUILT IS NAMED, not silently left out; a shorter deal analyses as a
   * different one.
   */
  const startSuggestedDeal = useCallback(
    (p: PartnerRecommendation) => {
      if (!p.suggestion || !rosterData) return
      const target = rosterData.rosters.find((r) => r.rosterId === p.rosterId) ?? null
      const mine = rosterData.rosters.find((r) => r.rosterId === rosterData.viewerTeamRosterId) ?? null
      const { give, get, dropped } = suggestionToPickedAssets(p.suggestion, mine, target)
      setGiveAssets(give)
      setGetAssets(get)
      setResult(null)
      setError(null)
      setCountering(null)
      setPartnerRosterId(p.rosterId)
      setDraftNote(
        dropped.length > 0
          ? `Started from a suggested deal with ${p.ownerName ?? 'that manager'}, without ${dropped.join(', ')} — that asset could not be rebuilt.`
          : `Started from a suggested deal with ${p.ownerName ?? 'that manager'} — adjust it, then analyse it.`,
      )
      goToStep('review')
    },
    [rosterData, goToStep],
  )

  /*
   * ⚠ THE BLOCKED STATE LEADS AND SUPPRESSES THE VERDICT. When the format says
   * this deal cannot happen, a fairness score is arithmetic about an impossible
   * transaction — showing it beneath a blocking banner would still invite
   * someone to read it.
   */
  const blocked = (result?.formatNotes ?? []).length > 0 && /cannot|does not exist|not a deal/i.test(
    (result?.formatNotes ?? [])[0] ?? '',
  )

  const noSignal = useMemo(() => {
    if (!result) return false
    const allUnpriced = [...give, ...get].every((l) => l.marketValue == null)
    return Boolean(result.degraded) || (give.length + get.length > 0 && allUnpriced)
  }, [result, give, get])

  const analyze = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/trade-value/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter: 'ALL',
          leagueId: props.league?.id ?? null,
          /*
           * ⚠ BOTH OF THESE ARE REQUIRED BY THE ROUTE'S SCHEMA, NOT OPTIONAL
           * EXTRAS. `strategy` and `teamContext` carry no `.default()` in
           * app/api/trade-value/analyze/route.ts, so omitting them fails zod
           * and the request comes back 400 before any analysis runs — the
           * button looked wired and never was.
           *
           * 'neutral' is the honest posture: this page does not ask the manager
           * whether they are contending, and guessing one would tilt the
           * narrative on an assumption they never made. 'my_team' is a fact,
           * not a guess — the give side IS the viewer's roster.
           */
          strategy: 'neutral',
          teamContext: 'my_team',
          /*
           * ⚠ THIS IS `LeagueTeam.externalId`, NOT A ROSTER ID AND NOT A USER
           * ID. The analyzer resolves the counterparty through LeagueTeam, and
           * an id from the wrong space returns no opponent rather than an
           * error — the leverage notes simply never appear and nothing says
           * why.
           */
          opponentTeamExternalId: partnerRoster?.teamExternalId ?? null,
          sideGive: giveAssets.map(toInput),
          sideGet: getAssets.map(toInput),
        }),
      })
      const j = (await r.json().catch(() => ({}))) as AnalyzeResult & { error?: string }
      if (!r.ok) {
        setError(j.error ?? 'Analysis failed.')
        setResult(null)
        return
      }
      setResult(j)
    } catch {
      setError('Network error.')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }, [props.league?.id, giveAssets, getAssets, partnerRoster?.teamExternalId])

  /*
   * ⚠ A LETTER PER SIDE, OR NO LETTER AT ALL. `projectedLetterFor` returns null
   * without signal rather than leaving that judgement to this component, so an
   * unpriced deal shows no badge instead of a C that reads as "even".
   *
   * `percentDiff` is signed from the viewer's side, so the opponent's grade is
   * the mirror of it.
   */
  const yourGrade = projectedLetterFor({
    percentDiff: result?.percentDiff ?? null,
    hasSignal: Boolean(result) && !noSignal,
  })
  const theirGrade = projectedLetterFor({
    percentDiff: result?.percentDiff != null ? -result.percentDiff : null,
    hasSignal: Boolean(result) && !noSignal,
  })

  /*
   * ── Draft persistence ──────────────────────────────────────────
   *
   * ⚠ THE ACCOUNT FIRST, THE BROWSER AS A FALLBACK, AND THE BANNER SAYS WHICH
   * ONE IT GOT. `TradeDraft` is a real table now, so a deal built on a phone can
   * be picked up on a laptop. But the migration is applied by hand on this
   * project, so the server save can legitimately fail — and when it does the
   * draft still has to go somewhere, with the manager told it went to this
   * browser only. "Saved" with no qualifier implies it will be on their phone
   * later, and half the time it would not be.
   *
   * ⚠ BOTH ARE ALWAYS WRITTEN. Writing only to whichever one succeeded would
   * mean a manager who saved while offline and then came back online silently
   * loses the newer copy to a stale server row.
   */
  const draftKey = props.league?.id ? `af-trade-draft:${props.league.id}` : null

  const saveDraft = useCallback(async () => {
    const leagueId = props.league?.id
    if (!draftKey || !leagueId) return

    let local = false
    try {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ give: giveAssets, get: getAssets, at: Date.now() }),
      )
      local = true
    } catch {
      /* Private browsing and full quotas both throw. */
    }

    let remote = false
    try {
      const r = await fetch(
        `/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ give: giveAssets, get: getAssets }),
        },
      )
      remote = r.ok
    } catch {
      /* Offline is a fallback, not a failure. */
    }

    setDraftNote(
      remote
        ? 'Saved to your account — it will be here on your other devices.'
        : local
          ? 'Saved on this device only. We could not reach your account, so it will not follow you.'
          : 'Nothing could store this draft — not your account, and not this browser.',
    )
  }, [draftKey, giveAssets, getAssets, props.league?.id])

  const applyDraft = useCallback((give: unknown, get: unknown, note: string) => {
    setGiveAssets(Array.isArray(give) ? (give as PickedAsset[]) : [])
    setGetAssets(Array.isArray(get) ? (get as PickedAsset[]) : [])
    /* A restored deal is not an analysed one. */
    setResult(null)
    setDraftNote(note)
  }, [])

  const restoreDraft = useCallback(async () => {
    const leagueId = props.league?.id
    if (!draftKey || !leagueId) return

    /*
     * ⚠ THE ACCOUNT WINS WHEN BOTH EXIST, and that is a choice rather than an
     * accident: the account copy is the one reachable from anywhere, so
     * preferring the browser would strand a manager on one machine. The browser
     * is consulted only when the account has nothing.
     */
    try {
      const r = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}`)
      const j = (await r.json().catch(() => ({}))) as {
        draft?: { payload?: { give?: unknown; get?: unknown } } | null
      }
      const payload = j?.draft?.payload
      if (payload && (Array.isArray(payload.give) || Array.isArray(payload.get))) {
        applyDraft(
          payload.give,
          payload.get,
          'Draft restored from your account — analyse it again to get a verdict.',
        )
        return
      }
    } catch {
      /* Fall through to the browser copy. */
    }

    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) {
        setDraftNote('No saved draft for this league, on your account or in this browser.')
        return
      }
      const parsed = JSON.parse(raw) as { give?: PickedAsset[]; get?: PickedAsset[] }
      applyDraft(
        parsed.give,
        parsed.get,
        'Draft restored from this browser — analyse it again to get a verdict.',
      )
    } catch {
      setDraftNote('That saved draft could not be read.')
    }
  }, [draftKey, props.league?.id, applyDraft])

  const intel = result?.tradeIntelligence

  /*
   * ── Value balance ────────────────────────────────────────────────────
   *
   * The two priced totals side by side, before any verdict. It is the
   * arithmetic the manager can check themselves, which is why it sits under
   * the builder rather than inside the verdict card.
   *
   * ⚠ UNPRICED LINES ARE EXCLUDED, AND THE RAIL SAYS SO. Counting a defender
   * the feed cannot price as zero would tilt the bar against whichever side
   * holds him — the same rule as the em dash on his row.
   */
  const balance = (() => {
    const g = pricedTotal(give)
    const k = pricedTotal(get)
    if (g == null && k == null) return null
    if (g == null || k == null || g + k === 0) {
      return { give: g, get: k, givePct: null as number | null, diff: null as number | null, pct: null as number | null }
    }
    const givePct = Math.round((g / (g + k)) * 100)
    const diff = k - g
    const pct = Math.round((Math.abs(diff) / Math.max(g, k)) * 100)
    return { give: g, get: k, givePct, diff, pct }
  })()

  const legend = assetTypesFor(props.leagueType, props.leagueVariant)

  const valueSources = Array.from(
    new Set(
      [...(result?.players?.give ?? give), ...(result?.players?.get ?? get)]
        .map((line) => line.pricedSource?.trim())
        .filter((source): source is string => Boolean(source)),
    ),
  )
  const yourIncentive = intel?.contenderRecommendation ?? intel?.why ??
    (balance?.diff != null && balance.diff >= 0
      ? `You receive about ${money(balance.diff)} more in current market value.`
      : 'The deal may improve your roster construction even when the raw market total is close.')
  const theirIncentive = balance?.diff != null && balance.diff <= 0
    ? `They receive about ${money(Math.abs(balance.diff))} more in current market value.`
    : `They receive ${give.length} asset${give.length === 1 ? '' : 's'}, which may fit a different timeline or positional need.`
  const agreementBlocker = intel?.tradeWarnings?.[0] ??
    (balance?.diff != null && balance.diff > 0
      ? `The current market baseline favors you by ${money(balance.diff)}, so they may ask for another asset.`
      : unpricedCount([...give, ...get]) > 0
        ? 'One or more assets are unpriced, which lowers confidence until fresh data is available.'
        : 'Manager preference, roster limits, and each team’s competitive window can still prevent agreement.')

  /*
   * Hand the deal to Chimmy.
   *
   * ⚠ PREFILL, NEVER SEND. The comms contract is explicit: a screen that fires a
   * question off on the user's behalf has spent their request allowance on
   * something they never typed and cannot take back. The question lands in the
   * box and they press send.
   *
   * The prefill names the actual assets rather than saying "this trade", because
   * the drawer does not carry the builder's state and a vague question produces
   * a vague answer.
   */
  const askChimmy = useCallback(() => {
    const side = (label: string, lines: Line[]) =>
      lines.length > 0 ? `${label}: ${lines.map((l) => l.name).join(', ')}` : null

    const parts = [side('I give', give), side('I get', get)].filter(Boolean).join('. ')
    const league = props.league?.name ? ` in ${props.league.name}` : ''
    const verdict = result?.labels?.fairnessLabel
      ? ` The analyzer says: ${result.labels.fairnessLabel}.`
      : ''

    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          prefill: parts
            ? `Explain this trade${league}. ${parts}.${verdict} What am I missing?`
            : `Help me think about a trade${league}.`,
        },
      }),
    )
  }, [give, get, props.league?.name, result])

  if (!props.league) {
    return <AllLeaguesTradeHub leagues={props.leagues ?? []} valueActions={valueActions} />
  }

  const hasAssets = giveAssets.length > 0 || getAssets.length > 0

  /**
   * One side's picker, with the props that make it send from the RIGHT roster.
   *
   * Extracted so the inline (desktop) and sheet (phone) placements cannot drift: the rule that
   * each column picks from its own roster was written once and must stay written once.
   */
  const renderPicker = (side: 'give' | 'get') => {
    const r = side === 'give' ? myRoster : partnerRoster
    return (
      <TradeAssetPicker
        sport={null}
        onClose={() => setPicking(null)}
        onPick={(a) => addAsset(side, a)}
        /*
          Each column sends from its OWN roster, so each gets its own
          picks. Passing the wrong side's would offer a manager a pick
          they do not hold and the engine would refuse it on send.
        */
        rosterPicks={r?.picks ?? []}
        rosterLabel={side === 'give' ? 'Your' : partnerRoster?.ownerName ?? null}
        teamCount={props.league?.teamCount ?? null}
        rosterKnown={Boolean(r)}
        /*
          Same rule as the picks directly above, for the same reason: each column sends
          from its OWN roster. Offering a player from the wrong side builds an asset the
          manager does not hold, and the engine only refuses it at send.
        */
        rosterPlayers={r?.players ?? []}
        faabAvailable={r?.faabRemaining ?? null}
        managerName={side === 'give' ? myRoster?.ownerName ?? 'You' : partnerRoster?.ownerName ?? null}
        managerAvatarUrl={r?.avatarUrl ?? null}
        /*
          ⚠ NULL ONLY WHEN THE ROSTER IS UNKNOWN, never because the record is 0-0-0.
          Pre-season every team is 0-0-0 and that is a real record, so collapsing it to
          null here would make the header say "no record" for the whole of September.
        */
        managerRecord={r ? { wins: r.wins, losses: r.losses, ties: r.ties } : null}
      />
    )
  }

  /*
   * What the persistent button does right now.
   *
   * ⚠ ON REVIEW, AN EMPTY SIDE SENDS YOU TO IT RATHER THAN TO THE ANALYSER. The analyze route
   * refuses a one-sided deal ("Add at least one asset on each side."), measured on the phone flow:
   * a manager who added only what they want got an error box after a network round trip. Naming
   * the missing step is the same information a turn earlier, as a control instead of a complaint.
   */
  const primary: { label: string; disabled: boolean; run: () => void } =
    mobileStep !== 'review'
      ? { label: 'Review trade', disabled: !hasAssets, run: () => goToStep('review') }
      : giveAssets.length === 0 && getAssets.length > 0
        ? { label: 'Add what you send', disabled: false, run: () => goToStep('give') }
        : getAssets.length === 0 && giveAssets.length > 0
          ? { label: 'Add what you get', disabled: false, run: () => goToStep('get') }
          : {
              label: busy ? 'Analyzing…' : result ? 'Analyze again' : 'Analyze trade',
              disabled: !hasAssets || busy,
              run: () => void analyze(),
            }

  return (
    <div className="af-tc" data-mobile-step={mobileStep}>
      <header className="af-tc-head">
        <div className="af-label">Core · Trades</div>
        <h1>Trade Center</h1>
        <p className="af-tc-lede">
          Build a deal across any league you&rsquo;re in and any asset class it allows. Context
          below the verdict is additive &mdash; it never touches the score above it.
        </p>
        {/*
          🛑 WHERE THE TRADE IS ACTUALLY SENT, AND THIS SCREEN HAD NO SUCH LINK.
          AllFantasy is read-only on every connected platform — Sleeper's API has
          no write endpoint at all — so a deal built here does not exist until it
          is re-entered on the source platform. My Team and Matchup have carried a
          `sourceLink` for that reason since they shipped; the trade builder, the
          one screen whose entire output is an action the user must take
          somewhere else, did not. The flow dead-ended on a verdict.

          `screen: 'trade'` lands on the platform's own trade page (Sleeper
          /trades, ESPN's team page, Yahoo's proposetrade) rather than the league
          home, and renders nothing at all for a native league or an unresolved
          host — never a guessed href.
        */}
        {props.sourceLink ? (
          <div className="af-tc-handoff">
            <SourceActionLink link={props.sourceLink} className="af-tc-handoff-link" />
            <span className="af-tc-handoff-note">
              AllFantasy never sends a trade for you — build it here, then send it there.
            </span>
          </div>
        ) : null}
      </header>

      {/* Every league at a glance, before this one's context — see the strip's own header. */}
      {props.leagues && props.leagues.length > 0 ? (
        <details className="af-tc-switcher">
          <summary>Switch league <span>{props.leagues.length} connected</span></summary>
          <TradeLeagueStrip leagues={props.leagues} activeLeagueId={props.league?.id ?? null} />
        </details>
      ) : null}

      {props.league ? (
        <div className="af-tc-context">
          {props.platform ? (
            <span
              className="af-tc-mark af-platform"
              data-platform={props.platform.toLowerCase()}
              aria-hidden
            >
              {platformMark(props.platform)}
            </span>
          ) : null}
          <span className="af-tc-context-name">{props.league.name}</span>
          <span className="af-tc-context-meta">
            {[props.league.format, props.league.teamCount ? `${props.league.teamCount} teams` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="af-tc-spacer" />
          {props.opponentLabel ? <span className="af-tc-chip">{props.opponentLabel}</span> : null}
          {props.deadlineLabel ? (
            <span className="af-tc-chip af-tc-chip--deadline">{props.deadlineLabel}</span>
          ) : null}
        </div>
      ) : null}

      {/*
        The asset vocabulary this LEAGUE can trade, shown regardless of what this
        deal contains. Scoped by the league's type when the caller knows it; the
        full six otherwise, because an unknown type must not read as a rule.
      */}
      <details className="af-tc-disclosure">
        <summary>{legend.types.length} tradeable asset types <span>View league rules</span></summary>
        <div className="af-tc-legend">
          <span className="af-tc-legend-label">
            {legend.scoped ? 'Asset types in this league' : 'Asset types supported'}
          </span>
          {legend.types.map((a) => (
            <span key={a.key} className="af-tc-asset-pill">
              <span className="af-tc-glyph" style={{ background: a.color }}>{a.glyph}</span>
              {a.label}
            </span>
          ))}
        </div>
      </details>

      {/*
        ⚠ FORMAT BLOCKERS LEAD THE PAGE. This is a correctness statement rather
        than another piece of advice, which is why it is not styled like the
        note cards below.
      */}
      {blocked ? (
        <div className="af-tc-banner af-tc-banner--blocked" data-mstep="review">
          <span className="af-tc-banner-glyph">!</span>
          <div>
            <p className="af-tc-banner-title">This trade can&rsquo;t be evaluated as shown</p>
            {(result?.formatNotes ?? []).map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </div>
      ) : null}

      {draftKey ? (
        <div className="af-tc-draft">
          <span>Saved drafts go to your account, so a deal you start on a phone is here on a laptop.</span>
          <span className="af-tc-spacer" />
          <button type="button" className="af-btn af-btn--ghost" onClick={() => void restoreDraft()}>
            Restore draft
          </button>
          {draftNote ? <span className="af-tc-row-sub">{draftNote}</span> : null}
        </div>
      ) : null}

      {/*
        Inbox and Sent sit ABOVE the builder because that is the order of the
        job: read what was offered, then price it. Below the builder they would
        be a footnote to a deal the manager had already hand-built.
      */}
      <TradeInbox
        leagueId={props.league?.id ?? null}
        onLoad={loadOffer}
        onCounter={startCounter}
        reloadToken={inboxReloadToken}
      />

      {valueActions.length > 0 ? (
        <details className="af-tc-value-actions">
          <summary><span>Value change alerts</span><b>{valueActions.length} players across your leagues</b></summary>
          <div className="af-tc-value-action-list">
            {valueActions.map((player) => (
              <div key={player.playerId} className="af-tc-value-action" data-direction={player.stock}>
                {player.imageUrl ? <img src={player.imageUrl} alt="" width={32} height={32} /> : <span className="af-tc-glyph">{player.position?.slice(0, 1) ?? 'P'}</span>}
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.position ?? 'Player'} · {player.stock === 'up' ? `up ${money(Math.abs(player.stockDelta ?? 0))}` : `down ${money(Math.abs(player.stockDelta ?? 0))}`} over 30 days</span>
                  <span className="af-tc-value-leagues">
                    {player.affectedLeagues.map((league, index) => (
                      <span key={league.id}>{index > 0 ? ' · ' : ''}<Link href={`/core/trades?league=${encodeURIComponent(league.id)}`}>{league.name}</Link></span>
                    ))}
                  </span>
                </div>
                <b>{player.advice}</b>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {/*
        ── PHONE STEP BAR ─────────────────────────────────────────────────────────────────────────
        🛑 STUCK TO THE TOP, BECAUSE THE BOTTOM IS TAKEN. The action row used to stick to the
        viewport bottom, and on /core that is where the shell draws its tab bar (z 40), the league
        pill (z 60) and the Comms launcher (z 59). Measured at 390px: the tab bar covered the lower
        half of the row, the league pill sat on "Analyze this trade" and the launcher on "Save
        draft" — the two controls that finish the task were the two nobody could press. The top of
        the viewport is the one edge the shell leaves free.

        Hidden above 720px by the stylesheet; the desktop page never sees it.
      */}
      <div ref={stepAnchorRef} className="af-tc-step-anchor" aria-hidden />
      <div className="af-tc-stepbar">
        <nav className="af-tc-steps" aria-label="Trade builder steps">
          {MOBILE_STEPS.map((s, i) => {
            const count = s.key === 'give' ? giveAssets.length : s.key === 'get' ? getAssets.length : null
            return (
              <button
                key={s.key}
                type="button"
                className="af-tc-step"
                data-on={mobileStep === s.key}
                aria-current={mobileStep === s.key ? 'step' : undefined}
                onClick={() => goToStep(s.key)}
              >
                <span className="af-tc-step-num" aria-hidden>{i + 1}</span>
                <span className="af-tc-step-label">{s.label}</span>
                {count != null ? <span className="af-tc-step-count af-num">{count}</span> : null}
              </button>
            )
          })}
        </nav>
        <div className="af-tc-stepbar-row">
          {/*
            ⚠ THE SAME PRICED-ONLY TOTALS AS THE VALUE RAIL, AND THE SAME EM DASH. A side with
            nothing priced reads "—", never "0", for the reason every other total here gives.
          */}
          <span className="af-tc-stepbar-totals af-num" aria-live="polite">
            <span>Send <b>{totalOf(give)}</b></span>
            <span>Get <b>{totalOf(get)}</b></span>
            {balance?.diff != null && balance.diff !== 0 ? (
              <span className="af-tc-stepbar-delta" data-tone={balance.diff > 0 ? 'good' : 'bad'}>
                {balance.diff > 0 ? '+' : '−'}
                {Math.abs(balance.diff).toLocaleString()}
              </span>
            ) : null}
          </span>
          {/*
            The persistent review control. On the building steps it moves to Review; on Review it
            runs the analysis. Disabled on an empty deal for the same reason Analyze always was.
          */}
          <button
            type="button"
            className="af-btn af-tc-stepbar-primary"
            disabled={primary.disabled}
            onClick={primary.run}
          >
            {primary.label}
          </button>
        </div>
      </div>

      {/*
        Naming the other side is not decoration. It is what turns on the whole
        counterparty half of the ledger, and what lets each column offer the
        picks that roster actually holds.
      */}
      {otherRosters.length > 0 ? (
        <div className="af-tc-partner" data-mstep="get">
          {/* Item #8: who is worth trading with, and a deal to start from. */}
          <TradePartnerSuggestions
            ranking={partnerRanking}
            selectedRosterId={partnerRosterId}
            onChoose={(rosterId) => {
              setPartnerRosterId(rosterId)
              setResult(null)
            }}
            onStartWith={startSuggestedDeal}
          />
          <span className="af-label">Trading with</span>
          <div className="af-tc-partner-chips">
            {otherRosters.map((r) => (
              <button
                key={r.rosterId}
                type="button"
                className="af-tc-chip af-tc-partner-chip"
                data-on={partnerRosterId === r.rosterId}
                onClick={() => {
                  setPartnerRosterId((prev) => (prev === r.rosterId ? null : r.rosterId))
                  /* The verdict belonged to the previous counterparty. */
                  setResult(null)
                }}
              >
                {r.ownerName ?? 'Another manager'}
              </button>
            ))}
          </div>
          {partnerRoster ? null : (
            <p className="af-tc-row-sub">
              Pick a team and the verdict gains their side of it &mdash; what they are short of,
              what the waiver wire would cost them, and how they have paid for the position before.
            </p>
          )}
        </div>
      ) : null}

      <div className="af-tc-builder" data-mstep="give get">
        {([
          { side: 'give' as const, label: 'Your team', handle: '@you', isYou: true, lines: give },
          {
            side: 'get' as const,
            label: theirLabel,
            handle: '',
            isYou: false,
            lines: get,
          },
        ]).map((side) => (
          <div key={side.side} className="af-tc-team" data-mstep={side.side}>
            <div className="af-tc-team-head">
              <span className="af-tc-team-name">{side.label}</span>
              {side.handle ? <span className="af-tc-team-handle">{side.handle}</span> : null}
              {side.isYou ? <span className="af-tc-you">YOU</span> : null}
              {props.platform ? (
                <>
                  <span className="af-tc-spacer" />
                  <span
                    className="af-tc-mark af-tc-mark--sm af-platform"
                    data-platform={props.platform.toLowerCase()}
                    aria-hidden
                  >
                    {platformMark(props.platform)}
                  </span>
                </>
              ) : null}
            </div>
            <span className="af-tc-sends">Sends</span>

            {side.lines.length === 0 ? (
              <p className="af-tc-row-sub">Nothing added yet.</p>
            ) : (
              side.lines.map((l, i) => (
                <div
                  key={`${side.label}-${l.name}-${i}`}
                  className="af-tc-row"
                  data-kind={kindOf(l)}
                >
                  {/*
                    ⚠ THE GLYPH IS THE FALLBACK, NOT THE LOSER. A headshot is absent for every pick,
                    every FAAB line and every player added by search, so replacing the glyph
                    outright would leave those rows with a hole where the others have a face. The
                    two occupy the same slot and the same size, so a mixed side stays aligned.
                  */}
                  {l.imageUrl ? (
                    <span className="af-tc-headshot" aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={l.imageUrl} alt="" loading="lazy" />
                    </span>
                  ) : (
                    <span className="af-tc-glyph" style={{ background: glyphFor(l).color }}>
                      {glyphFor(l).glyph}
                    </span>
                  )}
                  <span className="af-tc-row-body">
                    <span className="af-tc-row-name">{l.name}</span>
                    <span className="af-tc-row-sub">
                      {l.position ? (
                        <span className="af-tc-pos" data-pos={positionTone(l.position)}>
                          {l.position}
                        </span>
                      ) : null}
                      {l.team ? (
                        <span className="af-tc-row-team">
                          {resolveTeamLogoUrlSync(l.team, 'NFL') ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={resolveTeamLogoUrlSync(l.team, 'NFL') as string} alt="" loading="lazy" />
                          ) : null}
                          {l.team}
                        </span>
                      ) : null}
                      {/*
                        An asset with no price gets a tag, not a zero — a player or a pick. A pick
                        is unpriced only when it has no round, which is rare but real.
                        FAAB gets no tag: before Analyze it is waiting for the verdict's
                        conversion rather than missing a price, and the reason below says so.
                      */}
                      {l.marketValue == null && kindOf(l) !== 'faab' ? (
                        <span className="af-tc-tag" data-tone="bad">
                          Unpriced
                        </span>
                      ) : null}
                    </span>
                    {/*
                      WHY, IN WORDS (item #5). The dash and the tag said "no price"; they never said
                      whether that is a defender the feed will never cover, a feed that failed to
                      load, or a player we could not identify — three different next steps.
                    */}
                    {l.marketValue == null && l.unpricedWhy ? (
                      <span className="af-tc-unpriced-why">{l.unpricedWhy}</span>
                    ) : null}
                  </span>
                  <StockMark stock={l.stock} delta={l.stockDelta} />
                  <span
                    className="af-tc-row-value"
                    data-unpriced={l.marketValue == null ? 'true' : undefined}
                  >
                    {money(l.marketValue)}
                  </span>
                  <button
                    type="button"
                    className="af-tc-remove"
                    onClick={() => removeAsset(side.side, i)}
                    aria-label={`Remove ${l.name}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}

            {/*
              ⚠ ON A PHONE THE PICKER IS A SHEET AND THE BUTTON STAYS. The sheet is portalled to
              <body> so no ancestor's transform or backdrop-filter can become its containing block
              and clip a `position: fixed` overlay to the card; the button remains in place so the
              card does not jump when the sheet opens or closes.
            */}
            {picking === side.side && !isPhone ? (
              renderPicker(side.side)
            ) : (
              <button
                type="button"
                className="af-tc-add"
                aria-haspopup={isPhone ? 'dialog' : undefined}
                onClick={(e) => {
                  sheetOpenerRef.current = e.currentTarget
                  setPicking(side.side)
                }}
              >
                + Add asset
              </button>
            )}
            {picking === side.side && isPhone && typeof document !== 'undefined'
              ? createPortal(
                  /*
                    ⚠ THE TOKENS LIVE ON `.af-core` AND `.af-tc`, AND A PORTAL LEAVES BOTH BEHIND.
                    Without this wrapper every `var(--surface)` in the sheet resolves to nothing.
                    `display: contents` (af-trade-center.css) keeps the wrapper out of layout while
                    custom properties still inherit through it; the theme itself is keyed on
                    `html[data-mode]`, so light and AF modes reach the sheet unchanged.
                  */
                  <div className="af-core af-tc af-tc-sheet-root">
                    <TradeAssetSheet
                      label={side.side === 'give' ? 'Add an asset you send' : `Add an asset ${theirLabel} sends`}
                      onClose={() => setPicking(null)}
                      openerRef={sheetOpenerRef}
                    >
                      {renderPicker(side.side)}
                    </TradeAssetSheet>
                  </div>,
                  document.body,
                )
              : null}

            {/*
              🛑 WHAT THIS TEAM ACTUALLY HAS, ON THE SCREEN.
              Guap: "right now I don't know what either team has." The roster was already fetched
              and already passed to the picker — it was just rendered INSIDE the modal, so the
              page never showed it. Adding an asset should not be the only way to find out who is
              on a roster.

              ⚠ THE SAME ROW COMPONENT THE PICKER USES. A second copy of this markup is how the
              pick price ended up needing three separate fixes; one player must not look different
              in the list and in the deal.
            */}
            {(() => {
              const r = side.side === 'give' ? myRoster : partnerRoster
              const chosen = side.side === 'give' ? giveAssets : getAssets
              /*
                ⚠ MATCHED ON ID, NOT NAME. Two players share a name often enough that a name key
                would grey out the wrong man, and `playerId` is what the roster rows carry.
              */
              const inDeal = new Set(
                chosen.flatMap((a) => (a.kind === 'player' && a.playerId ? [a.playerId] : [])),
              )
              if (!r) {
                /*
                  ⚠ "WE DO NOT KNOW WHOSE ROSTER" IS NOT "THEY HOLD NOTHING", and the copy has to
                  keep them apart — the same rule the picker and the cross-league strip carry.
                */
                return side.side === 'get' ? (
                  <p className="af-tc-row-sub">
                    Pick a team above to see what they hold.
                  </p>
                ) : null
              }
              const players = r.players ?? []
              if (players.length === 0) {
                return (
                  <p className="af-tc-row-sub">
                    No players are listed on this roster yet.
                  </p>
                )
              }
              return (
                <details className="af-tc-roster" open>
                  <summary className="af-tc-roster-head">
                    <span className="af-label">
                      {r.ownerName ? `${r.ownerName}'s roster` : 'On this roster'} · {players.length}
                    </span>
                    <span className="af-tc-row-sub">Tap a player to add them</span>
                  </summary>
                  {/*
                    Capped and scrollable: two full rosters open at once would push the verdict —
                    the thing the page exists for — below the fold on every screen.
                  */}
                  <div className="af-tc-roster-list">
                    {players.map((pl) => (
                      <RosterPlayerRow
                        key={pl.id}
                        player={pl}
                        onAdd={() =>
                          addAsset(side.side, {
                            kind: 'player',
                            playerId: pl.id,
                            name: pl.name,
                            position: pl.position,
                            team: pl.team,
                            value: pl.value,
                            imageUrl: pl.imageUrl,
                            stock: pl.stock,
                            stockDelta: pl.stockDelta,
                            unpricedReason: pl.unpricedReason ?? null,
                          })
                        }
                        added={Boolean(pl.id && inDeal.has(pl.id))}
                      />
                    ))}
                  </div>
                </details>
              )
            })()}

            <div className="af-tc-total">
              <span>
                Total
                {unpricedCount(side.lines) > 0 ? (
                  <span className="af-tc-total-note"> · {unpricedCount(side.lines)} unpriced</span>
                ) : null}
              </span>
              <b className="af-num">{totalOf(side.lines)}</b>
            </div>
          </div>
        ))}
      </div>

      {/*
        ⚠ HIDDEN WHEN THE FORMAT BLOCKS THE DEAL, for the same reason the
        verdict is: a bar under a "this cannot happen" banner still gets read as
        a comparison.
      */}
      {/*
        ── PHONE REVIEW: BOTH SIDES ON ONE SCREEN ───────────────────────────────────────────────
        The builder cards are hidden on this step, so the deal is restated compactly with an Edit
        control per side. Read-only on purpose: removing an asset belongs to the step that shows the
        roster it came from. Hidden above 720px, where both cards are already side by side.
      */}
      <section className="af-tc-review" data-mstep="review" aria-label="Trade summary">
        {([
          { side: 'give' as const, title: 'You send', lines: give },
          { side: 'get' as const, title: `You get${partnerRoster ? ` · from ${theirLabel}` : ''}`, lines: get },
        ]).map((s) => (
          <div key={s.side} className="af-tc-review-side">
            <div className="af-tc-review-head">
              <span className="af-label">{s.title}</span>
              <span className="af-tc-spacer" />
              <button type="button" className="af-tc-review-edit" onClick={() => goToStep(s.side)}>
                Edit
              </button>
            </div>
            {s.lines.length === 0 ? (
              <p className="af-tc-row-sub">Nothing added yet.</p>
            ) : (
              <ul className="af-tc-review-list">
                {s.lines.map((l, i) => (
                  <li key={`${s.side}-${l.name}-${i}`}>
                    <span className="af-tc-review-name">{l.name}</span>
                    {l.position ? (
                      <span className="af-tc-pos" data-pos={positionTone(l.position)}>{l.position}</span>
                    ) : null}
                    <span className="af-tc-spacer" />
                    <span
                      className="af-num"
                      data-unpriced={l.marketValue == null ? 'true' : undefined}
                      title={l.marketValue == null && l.unpricedWhy ? l.unpricedWhy : undefined}
                      aria-label={
                        l.marketValue == null && l.unpricedWhy ? `No value: ${l.unpricedWhy}` : undefined
                      }
                    >
                      {money(l.marketValue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="af-tc-total">
              <span>
                Total
                {unpricedCount(s.lines) > 0 ? (
                  <span className="af-tc-total-note"> · {unpricedCount(s.lines)} unpriced</span>
                ) : null}
              </span>
              <b className="af-num">{totalOf(s.lines)}</b>
            </div>
          </div>
        ))}
      </section>

      {balance && !blocked ? (
        <div className="af-tc-balance" data-mstep="review">
          <div className="af-tc-balance-head">
            <span className="af-label">Value balance</span>
            <span className="af-tc-row-sub">priced assets only</span>
            <span className="af-tc-spacer" />
            <span
              className="af-tc-balance-delta af-num"
              data-tone={
                balance.diff == null ? 'faint' : balance.diff > 0 ? 'good' : balance.diff < 0 ? 'bad' : 'muted'
              }
            >
              {balance.diff == null
                ? 'Nothing priced on one side'
                : balance.diff === 0
                  ? 'Even on priced value'
                  : `${balance.diff > 0 ? '+' : '−'}${Math.abs(balance.diff).toLocaleString()} to you · ${balance.pct}% apart`}
            </span>
          </div>
          {balance.givePct != null ? (
            <div className="af-tc-balance-bar" aria-hidden>
              <span className="af-tc-balance-give" style={{ width: `${balance.givePct}%` }} />
              <span className="af-tc-balance-get" style={{ width: `${100 - balance.givePct}%` }} />
            </div>
          ) : null}
          <div className="af-tc-balance-ends af-num">
            <span data-side="give">You send · {money(balance.give)}</span>
            <span data-side="get">You get · {money(balance.get)}</span>
          </div>
        </div>
      ) : null}

      {error ? <p className="af-tc-nosignal" data-mstep="review">{error}</p> : null}

      {/*
        ⚠ THE VERDICT IS SUPPRESSED WHEN THE FORMAT BLOCKS THE DEAL. A score
        beneath a "this cannot happen" banner still gets read as a score.
      */}
      {result && !blocked ? (
        <section className="af-tc-verdict" data-mstep="review">
          <div className="af-tc-verdict-head">
            <span className="af-label af-tc-verdict-eyebrow">The verdict</span>
            <span className="af-tc-row-sub">
              projected &mdash; the realized grade locks in once real production posts
            </span>
          </div>

          <div className="af-tc-verdict-row">
            {yourGrade || theirGrade ? (
              <div className="af-tc-grade-row">
                {[
                  { label: 'You', letter: yourGrade },
                  { label: theirLabel, letter: theirGrade },
                ].map((g) =>
                  g.letter ? (
                    <div key={g.label} className="af-tc-grade" data-letter={g.letter}>
                      <span className="af-tc-grade-letter">{g.letter}</span>
                      <span className="af-tc-grade-for">{g.label}</span>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}
            <span className="af-tc-spacer" />
            <div className="af-tc-score">
              {typeof result.fairnessScore === 'number' ? (
                <span className="af-tc-score-num af-num">
                  {Math.round(result.fairnessScore)}
                  <small>/100</small>
                </span>
              ) : null}
              <strong className="af-tc-score-label">
                {result.labels?.fairnessLabel ?? 'No verdict'}
              </strong>
              {result.labels?.confidenceLabel ? (
                <span className="af-tc-conf">{result.labels.confidenceLabel}</span>
              ) : null}
            </div>
          </div>

          {/*
            ⚠ THE TRACK IS SIGNED, AND THE ENDS SAY WHICH WAY. The console's
            fairnessScore is `50 + 50·tanh((get − give) / …)` — 50 is even,
            below it the deal favours the other side, above it favours the
            viewer. The dot used to sit on an unlabelled bar; a manager reading
            41 could not tell whether that was good or bad for them.
          */}
          {typeof result.fairnessScore === 'number' ? (
            <div className="af-tc-track-wrap">
              <div className="af-tc-track">
                <span className="af-tc-track-mid" aria-hidden />
                <span
                  className="af-tc-dot"
                  style={{ left: `${Math.max(0, Math.min(100, result.fairnessScore))}%` }}
                />
              </div>
              <div className="af-tc-track-ends af-label" aria-hidden>
                <span>Favours {theirLabel}</span>
                <span>Even</span>
                <span>Favours you</span>
              </div>
            </div>
          ) : null}

          {/*
            gradeScale.ts: C spans a wide band, so a trade we know nothing about
            lands mid-C and reads identically to a genuinely even one. This is
            the callout that keeps those apart.
          */}
          {noSignal ? (
            <p className="af-tc-nosignal">
              We could not price enough of this deal to stand behind a verdict. An even-looking
              score here means we have no signal, not that the trade is fair.
            </p>
          ) : null}

          {(result.dataGaps ?? []).length > 0 ? (
            <>
              <div className="af-label">What we couldn&rsquo;t see</div>
              <ul className="af-tc-gaps">
                {(result.dataGaps ?? []).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {/* Additive context. Never merged with the verdict above. */}
      {result ? (
        <div className="af-tc-notes" data-mstep="review">
          {NOTE_GROUPS.map((g) => {
            const notes = (result[g.key] as string[] | undefined) ?? []
            if (notes.length === 0) return null
            /* Already on screen as the banner that suppressed the verdict. */
            if (g.key === 'formatNotes' && blocked) return null
            return (
              <div key={g.tone} className="af-tc-note" data-tone={g.tone}>
                <p className="af-tc-note-title">{g.title}</p>
                {notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}

      {intel ? (
        <section className="af-tc-dos" data-mstep="review">
          <div className="af-label">Decision OS · this deal</div>
          {intel.why ? <p className="af-tc-why">{intel.why}</p> : null}

          <div className="af-tc-pairs">
            <div className="af-tc-pair">
              <div className="af-tc-pair-label">Wins now</div>
              <div className="af-tc-pair-value">{intel.whoWinsNow ?? '—'}</div>
            </div>
            <div className="af-tc-pair">
              <div className="af-tc-pair-label">Wins long term</div>
              <div className="af-tc-pair-value">{intel.whoWinsLongTerm ?? '—'}</div>
            </div>
          </div>

          <div className="af-tc-incentives">
            <div className="af-tc-incentive" data-side="you">
              <div className="af-tc-pair-label">Why you may accept</div>
              <p>{yourIncentive}</p>
            </div>
            <div className="af-tc-incentive" data-side="them">
              <div className="af-tc-pair-label">Why {theirLabel} may accept</div>
              <p>{theirIncentive}</p>
            </div>
            <div className="af-tc-incentive" data-side="blocker">
              <div className="af-tc-pair-label">What may stop agreement</div>
              <p>{agreementBlocker}</p>
            </div>
          </div>

          <div className="af-label">How these values become advice</div>
          <div className="af-tc-value-layers">
            <div><span>Market baseline</span><strong>{money(balance?.give)} sent · {money(balance?.get)} received</strong></div>
            <div><span>Lineup effect</span><strong>{result?.needNotes?.[0] ?? 'No league-specific lineup edge was measured.'}</strong></div>
            <div><span>Consolidation</span><strong>{give.length} assets out · {get.length} assets in{result?.scaleNotes?.[0] ? ` · ${result.scaleNotes[0]}` : ''}</strong></div>
            <div><span>Team direction</span><strong>{result?.postureNotes?.[0] ?? intel?.rebuilderRecommendation ?? 'Use the contender and rebuilder reads for your current direction.'}</strong></div>
            <div><span>Data freshness</span><strong>{valueSources.length ? `Latest available ${valueSources.join(' + ')} snapshots` : 'No priced source was returned for this deal.'}</strong></div>
            <div><span>Source agreement</span><strong>{valueSources.length > 1 ? `Sources are shown separately because their methods can disagree; this verdict combines ${valueSources.length} available baselines.` : valueSources.length === 1 ? `One market source (${valueSources[0]}) priced the deal, so there is no cross-source consensus yet.` : 'No source comparison is possible until the assets are priced.'}</strong></div>
          </div>

          {/*
            The engine has always returned both reads; this page rendered
            neither. They are the two honest answers to "should I do this",
            because the right one depends on a fact only the manager knows.
          */}
          {intel.contenderRecommendation || intel.rebuilderRecommendation ? (
            <div className="af-tc-reads">
              {intel.contenderRecommendation ? (
                <div className="af-tc-read" data-tone="contender">
                  <div className="af-tc-pair-label">Contender read</div>
                  <p>{intel.contenderRecommendation}</p>
                </div>
              ) : null}
              {intel.rebuilderRecommendation ? (
                <div className="af-tc-read" data-tone="rebuilder">
                  <div className="af-tc-pair-label">Rebuilder read</div>
                  <p>{intel.rebuilderRecommendation}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {(intel.tradeWarnings ?? []).length > 0 ? (
            <>
              <div className="af-label">Warnings</div>
              <ul className="af-tc-list af-tc-list--warn">
                {(intel.tradeWarnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          ) : null}

          {(intel.rebalanceSuggestions ?? []).length > 0 ? (
            <>
              <div className="af-label">Rebalance ideas</div>
              <ul className="af-tc-list">
                {(intel.rebalanceSuggestions ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}

          {(intel.alternateTargets ?? []).length > 0 ? (
            <>
              <div className="af-label">Counter targets</div>
              <ul className="af-tc-list">
                {(intel.alternateTargets ?? []).map((t) => (
                  <li key={t.name}>
                    {t.name}
                    {t.position ? ` · ${t.position}` : ''} — {money(t.marketValue)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {intel.alternateTargetsNote ? (
            <p className="af-tc-row-sub">{intel.alternateTargetsNote}</p>
          ) : null}
        </section>
      ) : null}

      {/*
        The proposal sits AFTER the verdict, not beside the builder. Sending a
        deal is the last thing you do, and putting the button next to the assets
        invites sending one before it has been priced.
      */}
      {/*
        Wrapped rather than tagged: the panel owns its own root element. `display: contents` on the
        wrapper (stylesheet) keeps it out of the page's flex gap on every width.
      */}
      <div className="af-tc-mstep-wrap" data-mstep="review">
      <TradeProposePanel
        leagueId={props.league?.id ?? null}
        give={giveAssets}
        get={getAssets}
        rosters={rosterData?.rosters ?? null}
        viewerRosterId={rosterData?.viewerRosterId ?? null}
        partnerRosterId={partnerRosterId}
        onChoosePartner={setPartnerRosterId}
        counteringTradeId={countering?.tradeId ?? null}
        counteringLabel={countering?.label ?? null}
        onCancelCounter={() => setCountering(null)}
        onSent={() => {
          /*
           * Counter mode is armed for ONE send. Leaving it armed after a successful
           * counter would point the next send at a trade the engine has already
           * closed, and the second attempt would fail with a message about a trade
           * the manager thinks they are done with.
           */
          setCountering(null)
          setInboxReloadToken((n) => n + 1)
        }}
      />
      </div>

      {/*
        The finder answers "who should I trade with", which is the question of the "You get" step.
        ⚠ Its root reuses `.af-tc-dos`, the same class as the Decision OS section above — which is
        exactly why steps are keyed on `data-mstep` and never on a class name.
      */}
      <div className="af-tc-mstep-wrap" data-mstep="get">
        <TradeFinderPanel leagueId={props.league?.id ?? null} />
      </div>

      <div className="af-tc-actions" data-mstep="review">
        <p className="af-tc-caption">
          Grades here are projected, not realized — they price the deal as it stands today rather
          than how it turns out.
        </p>
        <button
          type="button"
          className="af-btn"
          onClick={analyze}
          disabled={busy || (giveAssets.length === 0 && getAssets.length === 0)}
        >
          {busy ? 'Analyzing…' : 'Analyze this trade'}
        </button>
        <button
          type="button"
          className="af-btn af-btn--ghost"
          onClick={() => void saveDraft()}
          disabled={!draftKey || (giveAssets.length === 0 && getAssets.length === 0)}
        >
          Save draft
        </button>
        <button type="button" className="af-btn af-btn--ghost" onClick={askChimmy}>
          Ask Chimmy to explain
        </button>
      </div>
    </div>
  )
}
