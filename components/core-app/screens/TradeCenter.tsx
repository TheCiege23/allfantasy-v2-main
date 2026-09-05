'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  RosterPlayerRow,
  StockMark,
  TradeAssetPicker,
  type PickedAsset,
} from '@/components/core-app/screens/TradeAssetPicker'
import { FIRST_ROUND_IN_MARKET_UNITS, pickValueByOverall } from '@/lib/pick-curve'
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

type AnalyzeResult = {
  labels?: { fairnessLabel?: string; confidenceLabel?: string }
  fairnessScore?: number
  confidenceScore?: number
  percentDiff?: number
  degraded?: boolean
  dataGaps?: string[]
  giveTotal?: number
  getTotal?: number
  players?: { give: Line[]; get: Line[] }
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

/**
 * Into the shape `TradeConsoleAnalyzeInput` accepts.
 *
 * ⚠ A PLAYER WITHOUT AN ID GOES BY NAME, which is what the engine's own schema
 * allows — the FantasyCalc search path returns no id, so requiring one would
 * make the most common search result unusable.
 */
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

  /** Prices the engine resolved, keyed by name, merged onto what was added. */
  const pricedBy = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const l of [...(result?.players?.give ?? []), ...(result?.players?.get ?? [])]) {
      m.set(l.name.toLowerCase(), l.marketValue ?? null)
    }
    return m
  }, [result])

  const toLines = useCallback(
    (assets: PickedAsset[]): Line[] =>
      assets.map((a) =>
        a.kind === 'player'
          ? {
              name: a.name,
              position: a.position,
              team: a.team,
              /* Engine price wins; the search value is the fallback. */
              marketValue: pricedBy.get(a.name.toLowerCase()) ?? a.value ?? null,
              imageUrl: a.imageUrl ?? null,
              stock: a.stock ?? null,
              stockDelta: a.stockDelta ?? null,
            }
          : a.kind === 'pick'
            ? {
                name: a.label,
                position: 'PICK',
                team: null,
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
                 */
                marketValue:
                  a.value ??
                  (Number.isFinite(a.round) && a.round >= 1
                    ? pickValueByOverall({
                        round: a.round,
                        teams: props.league?.teamCount ?? null,
                        firstRoundValue: FIRST_ROUND_IN_MARKET_UNITS,
                      })
                    : null),
              }
            : { name: `$${a.amount} FAAB`, position: 'FAAB', team: null, marketValue: null },
      ),
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
  const otherRosters = (rosterData?.rosters ?? []).filter(
    (r) => r.rosterId !== rosterData?.viewerTeamRosterId,
  )
  const theirLabel = partnerRoster?.ownerName ?? props.opponentLabel ?? 'Their team'

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
    },
    [],
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

  return (
    <div className="af-tc">
      <header className="af-tc-head">
        <div className="af-label">Core · Trades</div>
        <h1>Trade Center</h1>
        <p className="af-tc-lede">
          Build a deal across any league you&rsquo;re in and any asset class it allows. Context
          below the verdict is additive &mdash; it never touches the score above it.
        </p>
      </header>

      {/* Every league at a glance, before this one's context — see the strip's own header. */}
      {props.leagues && props.leagues.length > 0 ? (
        <TradeLeagueStrip leagues={props.leagues} activeLeagueId={props.league?.id ?? null} />
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
      <div className="af-tc-legend">
        <span className="af-tc-legend-label">
          {legend.scoped ? 'Asset types in this league' : 'Asset types supported'}
        </span>
        {legend.types.map((a) => (
          <span key={a.key} className="af-tc-asset-pill">
            <span className="af-tc-glyph" style={{ background: a.color }}>
              {a.glyph}
            </span>
            {a.label}
          </span>
        ))}
      </div>

      {/*
        ⚠ FORMAT BLOCKERS LEAD THE PAGE. This is a correctness statement rather
        than another piece of advice, which is why it is not styled like the
        note cards below.
      */}
      {blocked ? (
        <div className="af-tc-banner af-tc-banner--blocked">
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
      <TradeInbox leagueId={props.league?.id ?? null} onLoad={loadOffer} />

      {/*
        Naming the other side is not decoration. It is what turns on the whole
        counterparty half of the ledger, and what lets each column offer the
        picks that roster actually holds.
      */}
      {otherRosters.length > 0 ? (
        <div className="af-tc-partner">
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

      <div className="af-tc-builder">
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
          <div key={side.label} className="af-tc-team">
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
                        A player the feed could not price gets a tag, not a zero.
                        ⚠ THIS COMMENT USED TO SAY "picks and FAAB are unpriced by nature". FAAB
                        still is. PICKS ARE NOT, and have not been since they were put on the
                        curve — a pick now carries a real value in the same units as the players
                        beside it. The tag stays player-only because an unpriced PICK is now the
                        rare case (no round, or hand-typed) rather than the norm it used to be.
                      */}
                      {l.marketValue == null && kindOf(l) === 'player' ? (
                        <span className="af-tc-tag" data-tone="bad">
                          Unpriced
                        </span>
                      ) : null}
                    </span>
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

            {picking === side.side ? (
              <TradeAssetPicker
                sport={null}
                onClose={() => setPicking(null)}
                onPick={(a) => addAsset(side.side, a)}
                /*
                  Each column sends from its OWN roster, so each gets its own
                  picks. Passing the wrong side's would offer a manager a pick
                  they do not hold and the engine would refuse it on send.
                */
                rosterPicks={
                  side.side === 'give' ? myRoster?.picks ?? [] : partnerRoster?.picks ?? []
                }
                rosterLabel={side.side === 'give' ? 'Your' : partnerRoster?.ownerName ?? null}
                teamCount={props.league?.teamCount ?? null}
                rosterKnown={Boolean(side.side === 'give' ? myRoster : partnerRoster)}
                /*
                  Same rule as the picks directly above, for the same reason: each column sends
                  from its OWN roster. Offering a player from the wrong side builds an asset the
                  manager does not hold, and the engine only refuses it at send.
                */
                rosterPlayers={
                  side.side === 'give' ? myRoster?.players ?? [] : partnerRoster?.players ?? []
                }
                faabAvailable={
                  side.side === 'give'
                    ? myRoster?.faabRemaining ?? null
                    : partnerRoster?.faabRemaining ?? null
                }
                managerName={
                  side.side === 'give' ? myRoster?.ownerName ?? 'You' : partnerRoster?.ownerName ?? null
                }
                managerAvatarUrl={
                  side.side === 'give' ? myRoster?.avatarUrl ?? null : partnerRoster?.avatarUrl ?? null
                }
                managerRecord={(() => {
                  const r = side.side === 'give' ? myRoster : partnerRoster
                  /*
                    ⚠ NULL ONLY WHEN THE ROSTER IS UNKNOWN, never because the record is 0-0-0.
                    Pre-season every team is 0-0-0 and that is a real record, so collapsing it to
                    null here would make the header say "no record" for the whole of September.
                  */
                  return r ? { wins: r.wins, losses: r.losses, ties: r.ties } : null
                })()}
              />
            ) : (
              <button
                type="button"
                className="af-tc-add"
                onClick={() => setPicking(side.side)}
              >
                + Add asset
              </button>
            )}

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
      {balance && !blocked ? (
        <div className="af-tc-balance">
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

      {error ? <p className="af-tc-nosignal">{error}</p> : null}

      {/*
        ⚠ THE VERDICT IS SUPPRESSED WHEN THE FORMAT BLOCKS THE DEAL. A score
        beneath a "this cannot happen" banner still gets read as a score.
      */}
      {result && !blocked ? (
        <section className="af-tc-verdict">
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
        <div className="af-tc-notes">
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
        <section className="af-tc-dos">
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
      <TradeProposePanel
        leagueId={props.league?.id ?? null}
        give={giveAssets}
        get={getAssets}
        rosters={rosterData?.rosters ?? null}
        viewerRosterId={rosterData?.viewerRosterId ?? null}
        partnerRosterId={partnerRosterId}
        onChoosePartner={setPartnerRosterId}
      />

      <TradeFinderPanel leagueId={props.league?.id ?? null} />

      <div className="af-tc-actions">
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
