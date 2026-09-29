import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  getMarketValues,
  playerValue,
  playerValueForLeague,
  type MarketValuesPayload,
} from '@/lib/trade-intel/marketValueService'
import {
  FAIRNESS_BAND_REASON,
  findPackages,
  type DiscoveryPlayer,
  type DiscoveryRoster,
  type FairnessBand,
  type TradePackage,
} from '@/lib/trade-discovery/redraftTradeDiscovery'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import { describeScoringFit } from '@/lib/trade-value/scoringFit'
import { allocateFaabAcrossPool, type FaabCandidate } from '@/lib/trade-intel/faabBid'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { tradeBanReason } from '@/lib/league-rules/tradeLegality'
import { scheduleForLeague, survivorHorizon, type SurvivorHorizon } from '@/lib/trade-intel/survivorSchedule'
import { leagueContextFor, type LeagueContext } from './leagueContext'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { buildTeamProfile } from '@/lib/trade-value/teamProfile'
import type { TeamStance } from '@/lib/trade-value/types'
import type { LeagueContextEnvelope } from '@/lib/league-context/leagueContextService'
import type { SectionState } from './leagueHome'
import { leagueDisplayName } from './leagueHome'
import { normalizePosition } from './positionNormalization'
import { lineupSeatsFromSettings } from './slotEligibility'
import { lineupGainCalculator } from '@/lib/trade-intel/faabLineupGain'
import { FOREIGN_IDS_UNREADABLE } from './foreignIdSpaceCopy'
import { isForeignIdSpace, sleeperReadableRosters } from './rosterIdSpace'
import { leagueVariantFor } from './valueBook'
/*
 * Moved to `lib/trade-intel/marketContext.ts` (2026-09-24) so the trade analysis engine can use the
 * same rule without importing this module's whole graph. Re-exported so every importer — and every
 * test that mocks it here — is unchanged.
 */
import { marketContextFor } from '@/lib/trade-intel/marketContext'
export { marketContextFor }

/**
 * "Trade for him" — the visual, not the link.
 *
 * Guap's call (2026-09-02): when another manager has the player in the held
 * league, show what it would take and what we recommend, with the hand-off to
 * the platform inside the visual. This composes three things that already exist
 * and adds none of its own numbers:
 *
 *   1. AllFantasy market values (`getMarketValues`, DB-first, the FantasyCalc /
 *      DynastyProcess blend) under this league's format — dynasty vs redraft,
 *      1QB vs superflex, PPR weight, team count.
 *   2. The deterministic package finder (`findPackages`), told the target, which
 *      builds give/get packages from your surplus positions and bands their
 *      fairness on those values.
 *   3. THE trade grade — `createLeagueTradeGrader` + `gradeDeal`, the one grader every trade
 *      surface uses — on every package, from your side, with exactly the inputs the Trade
 *      Center's builder sends (`{ playerId, name }`), so this card and the builder it hands off
 *      to read one letter. Under a time budget, and reported as unavailable rather than guessed
 *      when it cannot answer.
 *
 * 🛑 THIS CARD USED TO PRINT A SECOND ENGINE'S VERDICT (2026-09-29). It ran `runTradeAnalysis`
 * (`lib/engine/trade`) and showed "Engine: accept/reject", starter points and acceptance odds
 * beside the finder's own fairness band — two verdicts from two models, neither of them the
 * letter the Trade Center gives the same deal one tap away. Both are gone from the screen: the
 * package is chosen by, and labelled with, the one grade. The band is still computed (the finder
 * needs it to build packages, and Chimmy's trade-target decision reads it) but is not printed,
 * and neither are the finder's band sentences (`FAIRNESS_BAND_REASON`).
 *
 * ⚠ THE PACKAGE FINDER'S OWN LOADER ONLY READS NATIVE REDRAFT LEAGUES
 * (`assembleDiscoveryLeague` keys on `redraftSeason`), and the Player Finder's
 * leagues are mostly imported. So this builds the two `DiscoveryRoster`s from
 * `Roster.playerData` itself — the same rows every other read on the screen
 * uses — and hands them to the same pure engine. Nothing here proposes,
 * sends or accepts anything.
 */

export type TradeVisualAsset = {
  kind: 'player' | 'faab'
  playerId: string | null
  name: string
  position: string | null
  value: number | null
}

export type TradeVisualPackage = {
  id: string
  give: TradeVisualAsset[]
  receive: TradeVisualAsset[]
  giveTotal: number
  receiveTotal: number
  /** receive minus give, in market-value units. Positive favours you. */
  delta: number
  /** The package finder's market-value band. Not printed — see the file header. */
  fairness: FairnessBand
  confidence: number
  reasons: string[]
  warnings: string[]
  /** THE grade of this package, from your side. */
  grade: SectionState<TradeVisualGrade>
}

/**
 * THE trade grade of a package (`lib/decision-os/trade/leagueTradeGrader.ts`) — the letter the
 * Trade Center shows for the same deal, and nothing from any other model.
 */
export type TradeVisualGrade = {
  /** For you — the side that gives. */
  letter: GradeLetter
  /** For the other manager. Always the mirror of `letter`. */
  partnerLetter: GradeLetter
  /** "Even", "Slightly favors you", … — read off the same number as the letter. */
  label: string
  recommendation: string
  /** League value each way: the totals the letter is taken on. */
  giveValue: number
  getValue: number
  /** The chart underneath, in a manager's words ("Dynasty · Superflex · 12 teams · PPR"). */
  basis: string
}

export type TradeVisualSide = {
  teamName: string
  ownerName: string | null
  /** The team's id on the platform, for the trade deep link. Null when we hold no team row. */
  externalId: string | null
  stance: TeamStance
  /** False until the record is long enough to read a direction from; the card then says so. */
  stanceSettled: boolean
  needs: string[]
  surpluses: string[]
}

export type PlayerTradeVisual = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId: string | null
  season: number | null
  target: {
    sleeperId: string
    name: string
    position: string | null
    value: number | null
    /**
     * The market's 30-day move in the same units as `value`, and his age — read by Chimmy's
     * trade-target verdict, where a dynasty call turns on both. Null when the feed or the player
     * row does not carry them; optional so a payload built before they existed still reads.
     */
    trend30Day?: number | null
    age?: number | null
  }
  you: TradeVisualSide
  partner: TradeVisualSide
  values: {
    mode: 'dynasty' | 'redraft'
    source: string
    fetchedAt: string
    ppr: number
    numQbs: 1 | 2
    /**
     * Why these prices differ from the chart's, when this league's per-position reception rules
     * move them. Null when nothing moved.
     *
     * 🛑 NOT OPTIONAL, ON PURPOSE. The prices in this payload are already adjusted, so a surface
     * that never renders this has quietly shown a number the chart does not carry.
     */
    scoringAdjustment: string | null
  }
  packages: TradeVisualPackage[]
  /** The package we would open with, or null when none is balanced enough to suggest. */
  recommended: TradeVisualPackage | null
  grade: SectionState<TradeVisualGrade>
  /**
   * Set when the league FORBIDS TRADES, in which case `packages` is empty and this is the answer.
   *
   * 🛑 ONLY A NO-TRADE ELIMINATION LEAGUE. Survivor All-Stars Guillotine says it outright — "there are
   * no trades allowed in this league" — so a package this surface could build is one the manager
   * can never send. What is real is that the man reaches waivers if his owner is chopped, and what
   * to bid when he does. A PLAIN guillotine or survivor league trades (concept catalog) and gets
   * packages, never this.
   */
  bidInstead: PlayerBidInstead | null
  /**
   * False when the league's format forbids trades, per `lib/league-rules/tradeLegality.ts`
   * (survivor-guillotine, tournament). `packages` is then empty and `recommended` null whether or
   * not a bid could be worked out.
   *
   * ⚠ THE BID IS NOT THE GATE. A no-trade league whose bid cannot be computed (no roster values, no
   * allocation) used to fall through with its packages intact — a plan the manager can never send.
   * Optional so a payload built before it existed still reads; absent means allowed.
   */
  tradesAllowed?: boolean
  /** The catalog's reason trades are forbidden, when they are. Shown on the no-trade card. */
  tradeBan?: string
}

export type PlayerBidInstead = {
  /** The canonical concept from `readFormatRules` — never a second opinion about the format. */
  concept: string
  /** The league's configured season budget, or null when it is not on file. */
  budgetTotal: number | null
  /** What he adds over your weakest starter at his slot. Zero or less means do not bid. */
  marginalValue: number
  /** His share of the upgrade value that would hit waivers with him, 0–1. */
  shareOfSupply: number
  /**
   * The bid against the FAAB this manager actually has left, or null when we do not hold it.
   *
   * ⚠ THIS FIELD WAS `ceilingAtFullBudget` FOR ONE COMMIT, ON A MEASUREMENT THAT WAS WRONG. The
   * probe behind it read `rosters.settings` and `waiver_budget_used` — both empty — and concluded
   * no per-team budget existed. It was in `rosters.faabRemaining` the whole time, a dedicated
   * column the probe never looked at: 3,266 of 3,418 rosters (96%) carry it, written by
   * `lib/sleeper-sync.ts` as `leagueBudget − waiver_budget_used` on every sync.
   *
   * 🛑 THE LESSON IS THE PROBE'S SHAPE, NOT THE COLUMN. An absence is only as trustworthy as the
   * places you looked, and "I checked two spellings in one JSON blob" is not "the database does
   * not have this".
   */
  ceilingAtRemaining: number | null
  /** What that manager has left, in dollars. Null when the roster row does not carry it. */
  budgetRemaining: number | null
  reason: string
}

const GRADE_BUDGET_MS = 6000

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

function allIds(pd: Record<string, unknown>): string[] {
  return [...new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])]
}

function contains(pd: Record<string, unknown>, id: string): boolean {
  return allIds(pd).includes(id)
}

/*
 * ── THE LEAGUE READS EVERY TRADE SURFACE HERE STARTS FROM ─────────────────────────────────────────
 *
 * Exported so the league-wide trade finder (`lib/chimmy/tradeFinderGrounding.ts`) builds its rosters
 * exactly as the player card and "should I trade for X?" do. Three copies of "which roster is yours"
 * and "what is this player worth here" would disagree the first time one of them was fixed.
 */

/** Every team and roster row in the league. The caller must have proved membership. */
export async function readLeagueTradeRows(leagueId: string) {
  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: {
          externalId: true,
          platformUserId: true,
          claimedByUserId: true,
          ownerName: true,
          teamName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
        },
      })
      .catch(() => []),
    prisma.roster
      .findMany({
        where: { leagueId },
        select: { platformUserId: true, playerData: true, faabRemaining: true, league: { select: { platform: true } } },
      })
      /*
       * A foreign league's ids collide with real Sleeper ids: read raw, the holder, "already on your
       * roster" and every priced package name strangers. Stripped here, every trade surface sees none.
       * An ESPN roster is translated instead — read raw, its 12483 (Stafford) priced as Jack Bech.
       */
      .then(async (rs) =>
        (await sleeperReadableRosters(rs, (r) => r.league?.platform)).map(({ league: _league, ...r }) => r),
      )
      .catch(() => []),
  ])
  return { teams, rosters }
}

export type LeagueTradeRows = Awaited<ReturnType<typeof readLeagueTradeRows>>
export type LeagueTradeTeam = LeagueTradeRows['teams'][number]
export type LeagueTradeRoster = LeagueTradeRows['rosters'][number]

/** The caller's claimed team, and the roster it owns. */
export function callerTradeSeat(
  rows: LeagueTradeRows,
  userId: string,
): { yours: LeagueTradeTeam | null; myRoster: LeagueTradeRoster | null } {
  const yours = rows.teams.find((t) => t.claimedByUserId === userId) ?? null
  const yourIds = new Set([yours?.platformUserId, yours?.externalId, userId].filter((x): x is string => Boolean(x)))
  const myRoster = rows.rosters.find((r) => yourIds.has(r.platformUserId)) ?? null
  return { yours, myRoster }
}

/** The team row that owns a roster. */
export function teamForTradeRoster(teams: LeagueTradeTeam[], roster: LeagueTradeRoster): LeagueTradeTeam | null {
  return (
    teams.find((t) => t.platformUserId === roster.platformUserId) ??
    teams.find((t) => t.externalId === roster.platformUserId) ??
    null
  )
}

/** Every player id on a roster: players, starters, reserve and taxi. */
export function tradeRosterPlayerIds(roster: LeagueTradeRoster): string[] {
  return allIds((roster.playerData ?? {}) as Record<string, unknown>)
}

export type TradePlayerRow = { sleeperId: string | null; name: string; position: string | null; age: number | null }

/** Name, position and age for a set of player ids, keyed by id. */
export async function readTradePlayerRows(ids: string[]): Promise<Map<string, TradePlayerRow>> {
  if (!ids.length) return new Map()
  const rows = await prisma.sportsPlayer
    .findMany({
      where: { sleeperId: { in: ids } },
      select: { sleeperId: true, name: true, position: true, age: true },
      distinct: ['sleeperId'],
    })
    .catch(() => [] as TradePlayerRow[])
  return new Map(rows.filter((r) => r.sleeperId).map((r) => [r.sleeperId as string, r]))
}

/*
 * ⚠ THE CHART IS FETCHED WITH ONE `ppr` AND APPLIES IT TO EVERY POSITION, so a league with a
 * per-position reception rule — TE premium being the common one — is priced by a chart that
 * models neither its tight ends nor its receivers. `playerValueForLeague` corrects for that and
 * returns BOTH numbers; `adjusted` equals `base` for an ordinary league, so nothing moves for
 * the leagues that already matched.
 */
export function toDiscoveryPlayers(
  roster: LeagueTradeRoster,
  byId: Map<string, TradePlayerRow>,
  values: MarketValuesPayload,
  leagueScoring: Record<string, number>,
): DiscoveryPlayer[] {
  return tradeRosterPlayerIds(roster).flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    const priced = playerValueForLeague(values, id, leagueScoring)
    return [
      {
        playerId: id,
        playerName: row.name,
        position: row.position ? normalizePosition(row.position) : 'UNK',
        value: priced?.adjusted ?? playerValue(values, id),
        isLocked: false,
      },
    ]
  })
}

/** One side of a trade: the team's stance, needs and surpluses over its priced players. */
export function toDiscoveryRoster(
  team: LeagueTradeTeam | null,
  rosterId: string,
  players: DiscoveryPlayer[],
  fallbackName: string,
  shape: { leagueSize: number; rosterSlots: string[] | null },
): DiscoveryRoster {
  const profile = buildTeamProfile({
    rosterId,
    wins: team?.wins ?? 0,
    losses: team?.losses ?? 0,
    ties: team?.ties ?? 0,
    pointsFor: team?.pointsFor ?? 0,
    playoffSeed: null,
    leagueSize: shape.leagueSize,
    positions: players.map((p) => p.position),
    rosterSlots: shape.rosterSlots,
  })
  return {
    rosterId,
    teamName: team?.teamName ?? fallbackName,
    managerDisplayName: team?.ownerName ?? null,
    stance: profile.stance,
    stanceSettled: profile.stanceSettled,
    weakPositions: profile.weakPositions,
    strongPositions: profile.strongPositions,
    players,
  }
}

/** The league's roster slots, as Sleeper labels them, when the settings carry them. */
export function rosterSlotsOf(settings: unknown): string[] | null {
  const s = (settings ?? {}) as Record<string, unknown>
  return Array.isArray(s.roster_positions) ? s.roster_positions.map(String) : null
}


function toAssets(list: TradePackage['giveAssets']): TradeVisualAsset[] {
  return list.map((a) => ({
    kind: a.kind,
    playerId: a.playerId ?? null,
    name: a.kind === 'faab' ? `$${a.faabAmount ?? 0} FAAB` : (a.playerName ?? 'Unknown player'),
    position: a.position ?? null,
    value: a.value,
  }))
}

const BAND_REASONS = new Set<string>(Object.values(FAIRNESS_BAND_REASON))

function toPackage(p: TradePackage): Omit<TradeVisualPackage, 'grade'> {
  return {
    id: p.packageId,
    give: toAssets(p.giveAssets),
    receive: toAssets(p.receiveAssets),
    giveTotal: Math.round(p.myTotalValue),
    receiveTotal: Math.round(p.partnerTotalValue),
    delta: Math.round(p.partnerTotalValue - p.myTotalValue),
    fairness: p.fairnessBand,
    confidence: p.confidence,
    // The finder's band sentence is its own fairness call; the one grade speaks for the package.
    reasons: p.reasons.filter((r) => !BAND_REASONS.has(r)),
    warnings: p.warningFlags,
  }
}

/** Where the package's assets go into the one grader: exactly the Trade Center builder's `toInput`. */
export function tradeVisualGradeInputs(assets: ReadonlyArray<TradeVisualAsset>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.kind === 'player' && a.playerId) out.assets.push({ kind: 'player', playerId: a.playerId, name: a.name })
    /*
     * Everything else is named, never dropped — leaving an asset out would grade the deal as though
     * it were not in it. That includes FAAB: this card's `value` for a FAAB asset is the finder's
     * NORMALISED value, not the dollar amount the grader prices, and the finder is called with
     * `faabSupported: false`, so a FAAB line here would be a surprise worth withholding on.
     */
    else out.unpriceable.push(a.name)
  }
  return out
}

function toVisualGrade(view: TradeGradeView): SectionState<TradeVisualGrade> {
  if (!view.graded) return { available: false, reason: view.reason.replace(/\.$/, '') }
  return {
    available: true,
    data: {
      letter: view.letter,
      partnerLetter: view.partnerLetter,
      label: view.label,
      recommendation: view.recommendation,
      giveValue: view.giveValue,
      getValue: view.getValue,
      basis: view.basis,
    },
  }
}

/**
 * A package worth opening with, on the ONE grade: even (C) or a slight edge to you (B). The same
 * two bands the finder's `balanced` / `slight edge you` stood for, now read off the letter the
 * Trade Center will show — so the card never recommends a deal the builder then calls an overpay.
 */
const OPENABLE_LETTERS: ReadonlyArray<GradeLetter> = ['C', 'B']
/** Only when no package could be graded does the finder's own band choose. */
const OPENABLE: FairnessBand[] = ['balanced', 'slight edge you']

/**
 * The package the card leads with. PURE. The first the one grade calls C or B; failing that, and
 * only when NOTHING was graded, the first the finder's band calls openable; failing that, the
 * finder's first. A graded D is never passed over for an ungraded "balanced" — the letter is the
 * better-informed answer even when it is the unwelcome one.
 */
export function recommendedPackage<P extends Pick<TradeVisualPackage, 'fairness' | 'grade'>>(packages: ReadonlyArray<P>): P | null {
  const byLetter = packages.find((p) => p.grade.available && OPENABLE_LETTERS.includes(p.grade.data.letter))
  if (byLetter) return byLetter
  const anyGraded = packages.some((p) => p.grade.available)
  return (anyGraded ? undefined : packages.find((p) => OPENABLE.includes(p.fairness))) ?? packages[0] ?? null
}

/**
 * How many of each position a lineup starts — the FALLBACK, used only when the league's own slots
 * are not on file or include one `lineupSeatsFromSettings` does not recognise. It is wrong for any
 * FLEX/SUPER_FLEX lineup, which is why it is no longer the default (see `faabLineupGain.ts`).
 */
const STARTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 }

/**
 * The FAAB candidates among `candidateIds`, each priced under the league's scoring and set against
 * YOUR starting lineup.
 *
 * With the league's slots readable (`leagueSettings.roster_positions`), a candidate's worth to you
 * is what he adds to your best legal lineup under those slots, and `displacedName` says who leaves
 * it. Without them it falls back to the fixed table: the weakest starter at his position, or 0 for
 * a seat you cannot fill.
 *
 * One implementation, shared by the Player Finder's bid card (`bidFor`, pool = one owner's roster)
 * and Chimmy's `get_faab_bid_plan` tool (pool = every valued unrostered player), so the two surfaces
 * cannot price the same player two ways. Pure. A candidate with no player row or no value is left
 * out, never priced at zero.
 */
export function faabPoolFor(args: {
  candidateIds: string[]
  byId: Map<string, { sleeperId: string | null; name: string; position: string | null }>
  values: MarketValuesPayload
  leagueScoring: Record<string, number>
  myPlayers: DiscoveryPlayer[]
  /** The league's raw settings. Omitted or slot-less, the fixed 1/2/2/1 table is used. */
  leagueSettings?: unknown
}): FaabCandidate[] {
  const seats = args.leagueSettings === undefined ? null : lineupSeatsFromSettings(args.leagueSettings)
  const gainFor = seats
    ? lineupGainCalculator(
        seats,
        args.myPlayers.map((p) => ({ id: p.playerId, name: p.playerName, position: p.position, value: p.value ?? null })),
      )
    : null

  /* Fallback only: your weakest starter at each position, by the fixed table. */
  const weakest: Record<string, number> = {}
  if (!gainFor) {
    for (const pos of Object.keys(STARTS)) {
      const atPos = args.myPlayers.filter((p) => p.position === pos).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      const starters = atPos.slice(0, STARTS[pos])
      weakest[pos] = starters.length >= STARTS[pos] ? (starters[starters.length - 1].value ?? 0) : 0
    }
  }

  return args.candidateIds.flatMap((id) => {
    const row = args.byId.get(id)
    if (!row) return []
    const priced = playerValueForLeague(args.values, id, args.leagueScoring)
    const value = priced?.adjusted ?? playerValue(args.values, id)
    if (value == null) return []
    const position = row.position ? normalizePosition(row.position) : 'UNK'
    if (gainFor) {
      /* replacedValue is expressed so that playerValue − replacedValue is exactly his lineup gain. */
      const { gain, displacedName } = gainFor({ id, name: row.name, position, value })
      return [{ id, name: row.name, position, playerValue: value, replacedValue: value - gain, displacedName }]
    }
    return [{
      id,
      name: row.name,
      position,
      playerValue: value,
      replacedValue: weakest[position] ?? 0,
    }]
  })
}

/**
 * What to bid for him, for a league where he cannot be traded for at any price.
 *
 * ⚠ THE POOL IS HIS OWNER'S WHOLE ROSTER, NOT HIM ALONE, AND THAT IS DELIBERATE. In a guillotine
 * league a player reaches waivers only when his owner is chopped — and then the whole roster
 * arrives at once. `allocateFaabAcrossPool` documents that a single candidate asserts "he is the
 * only upgrade available", which would be false here and would inflate him.
 */
function bidFor(args: {
  concept: string
  holderPlayerData: Record<string, unknown>
  targetSleeperId: string
  byId: Map<string, { sleeperId: string | null; name: string; position: string | null }>
  values: MarketValuesPayload
  leagueScoring: Record<string, number>
  /** The league's configured season budget. Context only — never the thing bid against. */
  faabBudget: number | null
  /** What THIS manager has left, from `rosters.faabRemaining`. This is what is bid against. */
  faabRemaining: number | null
  /** The published elimination schedule at this week, or null when the league has none on file. */
  horizon: SurvivorHorizon | null
  myPlayers: DiscoveryPlayer[]
  /** The league's raw settings, so the lineup gain is measured against its real slots. */
  leagueSettings: unknown
}): PlayerBidInstead | null {
  const pool = faabPoolFor({
    candidateIds: allIds(args.holderPlayerData),
    byId: args.byId,
    values: args.values,
    leagueScoring: args.leagueScoring,
    myPlayers: args.myPlayers,
    leagueSettings: args.leagueSettings,
  })
  if (!pool.length) return null

  /*
   * ⚠ THE HORIZON IS PASSED ONLY WHEN A REAL SCHEDULE RESOLVED, and null keeps the unpaced read.
   * Pacing needs a published elimination calendar and only leagues somebody has transcribed have
   * one — the module labels the unpaced case in its own reason string rather than letting it pass
   * for a paced number.
   *
   * ⚠ `faabRemaining` IS WHAT THIS MANAGER ACTUALLY HAS, not the league's season budget.
   * `lib/sleeper-sync.ts` writes it as `leagueBudget − waiver_budget_used` on every sync, and it
   * is present on 96% of rosters. Falling back to the league total would quietly tell somebody
   * down to their last $40 to bid like they were untouched.
   */
  const alloc = allocateFaabAcrossPool({
    pool,
    budgetRemaining: args.faabRemaining ?? 0,
    horizon: args.horizon,
  })
  const mine = alloc?.bids.find((b) => b.id === args.targetSleeperId)
  if (!alloc || !mine) return null

  return {
    concept: args.concept,
    budgetTotal: args.faabBudget,
    budgetRemaining: args.faabRemaining,
    marginalValue: mine.marginalValue,
    shareOfSupply: mine.shareOfSupply,
    ceilingAtRemaining: args.faabRemaining == null ? null : mine.ceiling,
    reason:
      mine.marginalValue <= 0
        ? `No trades in this league, and he would not improve your lineup anyway — ${mine.reason}`
        : `No trades in this league. He reaches waivers only if his owner is chopped, and his whole ` +
          `roster arrives with him: ${mine.reason}` +
          (args.faabRemaining == null
            ? ' We do not hold your remaining FAAB for this league, so that share cannot be turned into dollars.'
            : ''),
  }
}

export async function getPlayerTradeVisual(
  leagueId: string,
  targetSleeperId: string,
  userId: string | null,
  /**
   * The render's shared league context — see `leagueContext.ts`. The Player Finder runs this right
   * after `getPlayerLeagueView`, which reads the same row.
   */
  ctx?: LeagueContext | null,
): Promise<SectionState<PlayerTradeVisual>> {
  if (!userId) return { available: false, reason: 'sign in to build a trade for him' }

  const league = await leagueContextFor(leagueId, userId, ctx)
    .league()
    .catch(() => null)
  if (!league) return { available: false, reason: 'league not found' }

  const tradeRows = await readLeagueTradeRows(leagueId)
  const { teams, rosters } = tradeRows
  const { yours, myRoster } = callerTradeSeat(tradeRows, userId)
  if (!myRoster) return { available: false, reason: 'you need a claimed team in this league to build a trade' }

  // A foreign league's rosters are stripped (readLeagueTradeRows), so "no holder" there means we cannot
  // read them — not that he is free to claim.
  if (isForeignIdSpace(league.platform)) {
    return { available: false, reason: `${FOREIGN_IDS_UNREADABLE.toLowerCase()}, so we can't tell who holds him` }
  }
  const holder = rosters.find((r) => contains((r.playerData ?? {}) as Record<string, unknown>, targetSleeperId)) ?? null
  if (!holder) return { available: false, reason: 'he is not on any roster we can read here — claim him instead of trading for him' }
  if (holder.platformUserId === myRoster.platformUserId) {
    return { available: false, reason: 'he is already on your roster in this league' }
  }
  const partnerTeam = teamForTradeRoster(teams, holder)

  const leagueSize = rosters.length || 12
  /*
   * Built ONCE and reused. It was previously constructed twice from the same inputs, and the
   * scoring adjustment below needs the identical blob the chart request was keyed on — a second
   * reading of `scoring_settings` beside this one would be two implementations of one rule.
   */
  const marketContext = marketContextFor(league.settings, league.leagueType, leagueSize)
  const values: MarketValuesPayload | null = await getMarketValues(marketContext).catch(() => null)
  if (!values) {
    return { available: false, reason: 'no market values are loaded for this league’s format yet, so a package cannot be priced' }
  }

  const theirPd = (holder.playerData ?? {}) as Record<string, unknown>
  const byId = await readTradePlayerRows([
    ...new Set([...tradeRosterPlayerIds(myRoster), ...tradeRosterPlayerIds(holder)]),
  ])

  const leagueScoring = marketContext.scoring.settings
  const settings = (league.settings ?? {}) as Record<string, unknown>
  const shape = { leagueSize, rosterSlots: rosterSlotsOf(league.settings) }

  const me = toDiscoveryRoster(yours, myRoster.platformUserId, toDiscoveryPlayers(myRoster, byId, values, leagueScoring), 'Your team', shape)
  const partner = toDiscoveryRoster(
    partnerTeam,
    holder.platformUserId,
    toDiscoveryPlayers(holder, byId, values, leagueScoring),
    'Another manager',
    shape,
  )

  const targetRow = byId.get(targetSleeperId)
  /*
   * ── THE LEAGUE MAY NOT ALLOW TRADES AT ALL, IN WHICH CASE NO PACKAGE IS THE RIGHT ANSWER ──
   *
   * 🛑 WHETHER IT DOES IS THE CONCEPT CATALOG'S ANSWER (`lib/league-rules/tradeLegality.ts`), NOT
   * "IS IT A GUILLOTINE". This block used to refuse packages in every guillotine and survivor league.
   * The catalog marks trading LEGAL in both; only Survivor All-Stars Guillotine and Tournament forbid
   * it. Production (2026-09-28): 16 leagues were refused packages they could send, and 18 tournament
   * leagues were offered packages they could not. `readFormatRules` below still names the format
   * for the bid maths, but it maps survivor-guillotine onto plain guillotine, so it cannot decide this.
   *
   * Decided BEFORE grading, so a league that cannot trade is never charged the grader's reads.
   */
  const tradeBan = tradeBanReason({ leagueType: league.leagueType, isDynasty: marketContext.variant.dynasty, settings: league.settings })
  const tradesAllowed = tradeBan === null

  const found = findPackages({
    myRoster: me,
    partnerRoster: partner,
    sport: 'NFL',
    faabSupported: false,
    draftPickTrading: false,
    targetPlayerId: targetSleeperId,
    max: 3,
  }).map(toPackage)

  /*
   * THE grade of every package, from your side. One grader for the league (it reads the chart once),
   * then each package through `gradeDeal` — the same call the Trade Center's partner suggestions and
   * /trade-finder make. Budgeted: a page view cannot wait on it forever, and a miss is said, never
   * filled in with some other model's verdict.
   */
  const ungraded = (reason: string): SectionState<TradeVisualGrade> => ({ available: false, reason })
  let grades: Array<SectionState<TradeVisualGrade>> = found.map(() => ungraded('the trade grade did not answer in time'))
  if (tradesAllowed && found.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const graded = await Promise.race([
      (async () => {
        const grader = await createLeagueTradeGrader({ leagueId: league.id, userId })
        return Promise.all(
          found.map((p) =>
            gradeDeal(grader, { give: tradeVisualGradeInputs(p.give), get: tradeVisualGradeInputs(p.receive), viewerSide: true })
              .then(toVisualGrade)
              .catch(() => ungraded('this package could not be graded just now')),
          ),
        )
      })(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), GRADE_BUDGET_MS)
      }),
    ]).catch(() => found.map(() => ungraded('this package could not be graded just now')))
    if (timer) clearTimeout(timer)
    if (graded) grades = graded
  }
  const packages: TradeVisualPackage[] = found.map((p, i) => ({ ...p, grade: grades[i]! }))

  const recommended = recommendedPackage(packages)
  const grade: SectionState<TradeVisualGrade> = recommended ? recommended.grade : ungraded('no package to grade')

  const concept = readFormatRules({
    leagueType: league.leagueType,
    isDynasty: marketContext.variant.dynasty,
    /*
     * Carries the confirmed concept, read before the column (which holds only a
     * base format). It also switches on the keeper-provenance fallback, which can
     * only move keeper ↔ redraft — irrelevant to the guillotine/survivor test below.
     */
    settings: league.settings,
  }).concept
  /*
   * The bid card answers "no trades here, so what do I bid when his team is chopped?". That only
   * exists in a no-trade ELIMINATION league, where a released roster hits waivers. A plain guillotine
   * trades, so it gets packages. A tournament forbids trades but has no chop-to-waivers market, so it
   * gets the plain no-trade card.
   */
  const bidsInstead = !tradesAllowed && (concept === 'guillotine' || concept === 'survivor')
  const faabRaw = Number((settings as Record<string, unknown>).faab_budget)

  /*
   * ── PACING, WHEN AND ONLY WHEN THE LEAGUE HAS A PUBLISHED SCHEDULE ─────────────────────────
   *
   * ⚠ THE WEEK LOOKUP IS GATED ON THE SCHEDULE, NOT THE OTHER WAY AROUND. `resolveCurrentWeekForLeague`
   * is a database round trip, and the overwhelming majority of leagues have no schedule on file —
   * paying for a query whose answer can only be discarded would tax every league to serve one.
   */
  const schedule = bidsInstead ? scheduleForLeague(league.platformLeagueId) : null
  const resolvedWeek = schedule ? await resolveCurrentWeekForLeague(league.platformLeagueId ?? '').catch(() => null) : null
  const horizon = schedule && resolvedWeek ? survivorHorizon(schedule, resolvedWeek.week) : null

  const bidInstead = bidsInstead
      ? bidFor({
          horizon,
          concept,
          holderPlayerData: theirPd,
          targetSleeperId,
          byId,
          values,
          leagueScoring,
          faabBudget: Number.isFinite(faabRaw) && faabRaw > 0 ? faabRaw : null,
          faabRemaining: typeof myRoster.faabRemaining === 'number' ? myRoster.faabRemaining : null,
          myPlayers: me.players,
          leagueSettings: league.settings,
        })
      : null

  const stanceOf = (r: DiscoveryRoster, externalId: string | null): TradeVisualSide => ({
    teamName: r.teamName,
    ownerName: r.managerDisplayName ?? null,
    externalId,
    stance: r.stance,
    stanceSettled: r.stanceSettled ?? true,
    needs: r.weakPositions,
    surpluses: r.strongPositions,
  })

  return {
    available: true,
    data: {
      leagueId: league.id,
      leagueName: leagueDisplayName(league.name),
      platform: String(league.platform ?? 'manual').toLowerCase(),
      platformLeagueId: league.platformLeagueId ?? null,
      season: league.season ?? null,
      target: {
        sleeperId: targetSleeperId,
        name: targetRow?.name ?? 'this player',
        position: targetRow?.position ? normalizePosition(targetRow.position) : null,
        value:
          playerValueForLeague(values, targetSleeperId, leagueScoring)?.adjusted ??
          playerValue(values, targetSleeperId),
        trend30Day: values.bySleeperId[targetSleeperId]?.trend30Day ?? null,
        age: typeof targetRow?.age === 'number' ? targetRow.age : null,
      },
      you: stanceOf(me, yours?.externalId ?? null),
      partner: stanceOf(partner, partnerTeam?.externalId ?? null),
      values: {
        mode: values.mode,
        source: values.source,
        fetchedAt: values.fetchedAt,
        ppr: values.ppr,
        numQbs: values.numQbs,
        scoringAdjustment: describeScoringFit(leagueScoring, values.ppr),
      },
      /*
       * 🛑 A NO-TRADE LEAGUE GETS NO PACKAGES. Leaving them in would offer a manager a plan they
       * cannot execute, which is worse than offering nothing — it looks actionable.
       */
      packages: tradesAllowed ? packages : [],
      recommended: tradesAllowed ? recommended : null,
      grade: tradesAllowed
        ? grade
        : { available: false, reason: 'this league does not allow trades, so there is no package to grade' },
      bidInstead,
      tradesAllowed,
      ...(tradeBan ? { tradeBan } : {}),
    },
  }
}
