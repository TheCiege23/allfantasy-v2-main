import 'server-only'

import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from './leagueTradeGrader'
import type { TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { giveawayReason } from '@/lib/trade-intel/tradeGiveaway'
import { emptySideIndex, isPirateSteal, pirateStealReason, PIRATE_STEAL_KIND } from '@/lib/trade-intel/pirateSteal'
import {
  frozenOriginalFor,
  saveFrozenCompletedGrades,
  sleeperTradeKey,
  withFrozenOriginal,
  frozenAssetKeys,
  type FrozenCompletedGrade,
  type FrozenCompletedGradeV1,
  type TradeDatePrice,
} from './frozenCompletedGrade'
import type { RepriceOutcome } from './repriceFrozenTradeGrades'
import { chooseTradeTimeCapture, gradedAtTradeTime, MAX_CAPTURE_AGE_MS, tradeTimeOf } from './tradeTimeCapture'
import { loadCaptureDays, loadDatedMarket, type DatedMarket, type MarketBook } from './datedMarket'
import type { TradeValueSource } from './valueSource'

/**
 * THE grade for a COMPLETED provider trade — the grade email, the /core history and the dashboard
 * band all read it from here, so a finished deal carries one letter wherever it appears.
 *
 * The letter is the trade's FROZEN ORIGINAL — taken the first time any surface graded it, which for
 * an imported trade can be long after the trade itself — with today's re-grade beside it as
 * `current`, never merged into it (`frozenCompletedGrade.ts`). Only a deal not yet graded is priced
 * on today's values, and that grade becomes the original.
 *
 * Graded from side one's point of view, on this league's values, and WITHOUT roster need: the trade
 * has happened and both rosters already hold its result, so "does this fill a hole" has no honest
 * answer.
 *
 * 🛑 A USED PICK IS GRADED AS THE PLAYER DRAFTED WITH IT (Guap's ruling, 2026-09-25) — ON TODAY'S
 * LINE (`current`). Once its draft is held a pick no longer exists as a pick: pricing it as one priced
 * a 2026 pick off a February board months after the rookies were taken, and an older used pick
 * withheld the letter outright. The pick became a player, and that player's value today is what the
 * pick is worth. Only a pick the draft results cannot resolve, and whose season has passed, still
 * withholds.
 *
 * 🛑 THE ORIGINAL IS PRICED AT THE TIME OF THE TRADE (Guap's ruling, 2026-10-03) — see
 * `gradeAtTradeTime` below. There a pick traded before its draft is priced AS THE PICK it was on the
 * trade date (Decision 3), from that day's stored pick rows; the drafted player stays on `current`.
 */

/*
 * One grader per league, briefly memoised: a history page asks for a grade per trade, and the chart
 * behind every one of them is the same. Five minutes is well inside the chart's own freshness.
 */
const GRADER_TTL_MS = 5 * 60 * 1000
const graders = new Map<string, { at: number; grader: Promise<LeagueTradeGrader | null> }>()

export function completedTradeGraderFor(leagueId: string): Promise<LeagueTradeGrader | null> {
  const hit = graders.get(leagueId)
  if (hit && Date.now() - hit.at < GRADER_TTL_MS) return hit.grader
  const grader = createLeagueTradeGrader({ leagueId }).catch(() => null)
  graders.set(leagueId, { at: Date.now(), grader })
  return grader
}

type Side = GradedTrade['sides'][number]

/**
 * A traded player in the grader's terms, carrying his Sleeper id when the caller has one.
 *
 * 🛑 BY ID, NOT BY NAME — THE SAME WAY THE LIVE AND PENDING PATHS HAVE ALWAYS SENT HIM. Until
 * 2026-09-28 every completed-trade surface (grade email, Trade Center timeline, dashboard band, /core
 * history, player card, activity feed, trades board) sent the name alone, while the pending inbox,
 * the /core inbox and the Trade Center panel (`gradeInputsFromPending`) sent the Sleeper id and
 * position. A name-only player is priced through `findPlayerByName` and a lower-cased name map; an id
 * is priced exactly, with a position check. This repo carries 178 NFL duplicate-name groups, so one
 * deal could be priced as two different people depending on which screen read it. Every Sleeper
 * league in production is NFL (345 of 345, measured 2026-09-28), and the NFL branch of the pricer
 * always honours a Sleeper id — it never turns a priceable player into an unresolved one.
 */
export function sleeperPlayerInput(name: string, sleeperId?: string | null, position?: string | null): TradeAssetInput {
  const id = sleeperId?.trim()
  const pos = position?.trim()
  return {
    kind: 'player',
    name,
    ...(id ? { providerIdentity: { provider: 'sleeper' as const, id, ...(pos ? { position: pos } : {}) } } : {}),
  }
}

/** What side one sent and received, in the one grader's terms. */
export function completedTradeInputs(trade: GradedTrade, currentSeason: number): { give: GradeInputs; get: GradeInputs } | null {
  const [a] = trade.sides
  if (!a) return null
  const side = (players: Side['playersIn'], picks: Side['picksIn'], faab: number | undefined): GradeInputs => {
    const out: GradeInputs = { assets: players.map((p) => sleeperPlayerInput(p.name, p.playerId, p.position)), unpriceable: [] }
    for (const pick of picks) {
      const year = Number(pick.season)
      // Used: the draft resolved it to a player. Checked FIRST — a current-season pick is used too.
      const drafted = pick.resolved?.name?.trim()
      if (drafted) out.assets.push(sleeperPlayerInput(drafted, pick.resolved?.playerId, pick.resolved?.position))
      else if (Number.isFinite(year) && year >= currentSeason && pick.round > 0) out.assets.push({ kind: 'pick', year, round: pick.round })
      else out.unpriceable.push(pick.label)
    }
    // FAAB LAST — players, picks, FAAB is the order the email lists a side's assets and aligns values to.
    // Priced on the league's own waiver budget by the chart (`lib/trade-value/faabValue.ts`).
    if (faab != null && Number.isFinite(faab) && faab > 0) out.assets.push({ kind: 'faab', amount: faab })
    return out
  }
  return { give: side(a.playersOut, a.picksOut, a.faabOut), get: side(a.playersIn, a.picksIn, a.faabIn) }
}

/**
 * What side one sent and received AT THE TIME OF THE TRADE: every pick as the pick it was then
 * (Decision 3, 2026-10-03), never the player later drafted with it — a pick is only ever traded
 * before its draft. Players and FAAB exactly as `completedTradeInputs` sends them.
 */
export function completedTradeInputsAtTradeTime(trade: GradedTrade): { give: GradeInputs; get: GradeInputs } | null {
  const [a] = trade.sides
  if (!a) return null
  const side = (players: Side['playersIn'], picks: Side['picksIn'], faab: number | undefined): GradeInputs => {
    const out: GradeInputs = { assets: players.map((p) => sleeperPlayerInput(p.name, p.playerId, p.position)), unpriceable: [] }
    for (const pick of picks) pushPickAtTradeTime(out, pick.season, pick.round, pick.label)
    if (faab != null && Number.isFinite(faab) && faab > 0) out.assets.push({ kind: 'faab', amount: faab })
    return out
  }
  return { give: side(a.playersOut, a.picksOut, a.faabOut), get: side(a.playersIn, a.picksIn, a.faabIn) }
}

function pushPickAtTradeTime(out: GradeInputs, season: string | number | null, round: number | null, label: string): void {
  const year = Number(season)
  if (Number.isFinite(year) && year > 0 && round != null && round > 0) out.assets.push({ kind: 'pick', year, round })
  else out.unpriceable.push(label)
}

/*
 * The only evidence a trade-date grade may stand on: that day's FantasyCalc rows (players, below-chart
 * floor at 0, pick rows) and the league's own FAAB formula, which has no date. Anything else on a line
 * — a defender's league board, a devy option, a sports-db row, the historical file, a curve — is a
 * second source, and one is enough to send the whole trade back to its first-graded original.
 */
const TRADE_DATE_SOURCES: ReadonlySet<TradeValueSource> = new Set(['fantasycalc', 'fantasycalc_pick', 'faab_formula'])

export type TradeTimeDeps = {
  captureDays?: (book: MarketBook) => Promise<string[]>
  market?: (book: MarketBook, day: string) => Promise<DatedMarket | null>
  /**
   * Price a trade graded within a day of happening on the grader's own LIVE chart (default true).
   * Off only for a grader built `marketless`, which has no live chart — the re-price script.
   */
  liveChart?: boolean
}

/**
 * THE GRADE OF A COMPLETED TRADE PRICED AT THE TIME OF THE TRADE (Guap's ruling, 2026-10-03), or null
 * when it cannot be — and then the caller keeps the first-graded original (Decision 1).
 *
 * Not a second grader: the league's own grader, on the same pricer and the same `gradeTrade`, in one
 * of two ways — and the stored capture is only ever the SECOND choice:
 *
 *   1. GRADED WITHIN A DAY OF THE TRADE (`gradedAtTradeTime`: the trade happened at most 24h before
 *      `now`, and not after it) → the market at the time of the trade IS today's market, so it is
 *      priced on the league's own LIVE chart — its own team count, reception weight and scoring.
 *      `pricedAsOf` is `now`.
 *   2. GRADED LATER → one day's stored market in place of today's (`LeagueTradeGrader.atMarket` →
 *      `withDatedMarket`): the latest capture taken at or before the trade, at most a day old.
 *      `pricedAsOf` is that capture's day.
 *
 * 🛑 WHY THE LIVE CHART FIRST. The capture is FantasyCalc's 12-team PPR-1 book, not the league's.
 * Team count and PPR move that book almost uniformly, but not exactly — and at a letter boundary
 * "almost" is a different letter. The production dry run of 2026-10-03 found 13 frozen originals
 * (12 of them emailed) taken on the trade day on the league's own chart whose letter the 12-team
 * book would have changed with the market not having moved at all. The capture is the best record
 * there is of a past market; it is never a substitute for the league's own chart when that chart
 * is the market at the time of the trade.
 *
 * 🛑 ONE DATE, ONE SCALE, OR NOTHING. A trade is never priced partly on its date and partly on today's
 * values or the historical file. Null when ANY of these holds — and the whole trade falls back:
 *   - no grader, no league book (no market context, or a college league), no trade time;
 *   - no capture within a day before the trade (gaps in the series, anything before 2026-08-16);
 *   - a player without a Sleeper id (the dated rows are keyed by it; a name join is not a price);
 *   - an asset the grade withholds on (a defender, kicker or team defense — no dated source; a pick
 *     before 2026-09-20, or in a redraft book, which stores no picks);
 *   - any line priced from anything but that day's rows (`TRADE_DATE_SOURCES`).
 */
export async function gradeAtTradeTime(
  grader: LeagueTradeGrader | null,
  inputs: { give: GradeInputs; get: GradeInputs } | null,
  tradeAt: Date | null,
  deps: TradeTimeDeps = {},
  /** When the grading happens — decides the live chart (within a day of the trade) or the capture. */
  now: Date = new Date(),
): Promise<TradeDatePrice | null> {
  try {
    if (!grader?.atMarket || !grader.book || !inputs || !tradeAt) return null
    if (inputs.give.unpriceable.length + inputs.get.unpriceable.length > 0) return null
    const assets = [...inputs.give.assets, ...inputs.get.assets]
    if (assets.some((a) => a.kind === 'player' && a.providerIdentity?.provider !== 'sleeper')) return null

    if (deps.liveChart !== false && gradedAtTradeTime(tradeAt, now)) {
      // 1. Today's market is the market at the time of the trade: the league's own live chart.
      const view = await gradeDeal(grader, { give: inputs.give, get: inputs.get, viewerSide: false })
      if (!view.graded || view.lines.length !== assets.length) return null
      for (const line of view.lines) {
        if (!line.valueSource || !TRADE_DATE_SOURCES.has(line.valueSource)) return null
        if (line.valueSource === 'faab_formula') continue
        // The chart's own sync time must itself sit within the tolerance of the trade.
        const synced = line.valueAsOf ? Date.parse(line.valueAsOf) : NaN
        if (!Number.isFinite(synced) || synced > now.getTime() || tradeAt.getTime() - synced > MAX_CAPTURE_AGE_MS) return null
      }
      return { grade: view, pricedAsOf: now.toISOString() }
    }

    // 2. Graded later: the stored capture from the trade's own date.
    const days = await (deps.captureDays ?? loadCaptureDays)(grader.book)
    const capture = chooseTradeTimeCapture(days, tradeAt)
    if (!capture) return null
    const market = await (deps.market ?? loadDatedMarket)(grader.book, capture.day)
    if (!market || market.capturedOn !== capture.day) return null
    const view = await gradeDeal(grader.atMarket(market), { give: inputs.give, get: inputs.get, viewerSide: false })
    if (!view.graded) return null
    // Every asset on a line, and every line from that day's rows.
    if (view.lines.length !== assets.length) return null
    const asOf = `${capture.day}T00:00:00.000Z`
    for (const line of view.lines) {
      if (!line.valueSource || !TRADE_DATE_SOURCES.has(line.valueSource)) return null
      if (line.valueSource !== 'faab_formula' && line.valueAsOf !== asOf) return null
    }
    return { grade: view, pricedAsOf: capture.day }
  } catch {
    return null
  }
}

/**
 * The original a completed-trade surface shows, and the row to freeze — the one decision every
 * surface makes the same way. A frozen original wins; otherwise the deal is priced at the time of the
 * trade when it can be, and on today's values (`current`) when it cannot.
 */
export async function completedOriginal(args: {
  grader: LeagueTradeGrader | null
  tradeId: string
  inputs: { give: GradeInputs; get: GradeInputs }
  /** The same deal at the time of the trade (picks as picks). Null: it cannot be priced on its date. */
  tradeTimeInputs: { give: GradeInputs; get: GradeInputs } | null
  tradeAt: Date | null
  current: TradeGradeView
  frozen: FrozenCompletedGrade | undefined
  now: Date
  deps?: TradeTimeDeps
}): Promise<{ view: TradeGradeView; toFreeze: FrozenCompletedGrade | null }> {
  // Pricing on the trade date costs a capture read; a frozen original never needs one.
  const dated = args.frozen ? null : await gradeAtTradeTime(args.grader, args.tradeTimeInputs, args.tradeAt, args.deps, args.now)
  return withFrozenOriginal({
    tradeId: args.tradeId,
    inputs: args.inputs,
    current: args.current,
    frozen: args.frozen,
    now: args.now,
    dated,
    tradeAt: args.tradeAt?.toISOString() ?? null,
  })
}

/**
 * One existing v1 original, re-priced at the time of its trade (Decision 2) — by the same
 * `gradeAtTradeTime` every new freeze uses, oriented exactly as the stored row. For
 * `scripts/reprice-frozen-trade-grades-at-trade-time.ts`; see `repriceFrozenTradeGrades.ts`.
 *
 * `deal` is the trade as a surface reads it today (to match the row's asset keys) and at the time of
 * the trade (what is priced). A deal that matches the row neither way is a different deal: skipped.
 *
 * 🛑 A v1 ROW FROZEN WITHIN A DAY AFTER ITS TRADE IS CARRIED, NOT RE-PRICED. It was already priced at
 * the time of the trade, on the league's OWN live chart — a better record than the 12-team PPR-1
 * capture, which would move its letter at a boundary with no market move at all. It becomes a
 * `trade_date` row with the v1 letter and `pricedAsOf` = the v1 `frozenAt`.
 */
export async function repriceFrozenOriginalAtTradeTime(args: {
  grader: LeagueTradeGrader | null
  row: FrozenCompletedGradeV1
  deal: { today: { give: GradeInputs; get: GradeInputs }; atTradeTime: { give: GradeInputs; get: GradeInputs } } | null
  tradeAt: Date | null
  deps?: TradeTimeDeps
}): Promise<RepriceOutcome> {
  if (args.tradeAt && gradedAtTradeTime(args.tradeAt, new Date(args.row.frozenAt))) {
    return { kind: 'carried', tradeAt: args.tradeAt.toISOString() }
  }
  if (!args.deal) return { kind: 'skip', why: 'the trade is not on record' }
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  const give = frozenAssetKeys(args.deal.today.give)
  const get = frozenAssetKeys(args.deal.today.get)
  const atTradeTime = same(give, args.row.give) && same(get, args.row.get)
    ? args.deal.atTradeTime
    : same(give, args.row.get) && same(get, args.row.give)
      ? { give: args.deal.atTradeTime.get, get: args.deal.atTradeTime.give }
      : null
  if (!atTradeTime) return { kind: 'skip', why: 'the recorded assets do not match the frozen row' }
  if (!args.grader) return { kind: 'skip', why: 'the league could not be read' }
  if (!args.tradeAt) return { kind: 'skip', why: 'no trade time' }
  const tradeAt = args.tradeAt.toISOString()
  if (!args.grader.book) return { kind: 'first_graded', tradeAt, why: 'the league prices on no stored market book' }
  const days = await (args.deps?.captureDays ?? loadCaptureDays)(args.grader.book)
  if (!chooseTradeTimeCapture(days, args.tradeAt)) return { kind: 'first_graded', tradeAt, why: 'no capture within a day before the trade' }
  // The capture only: a marketless grader has no live chart, and these trades are long past.
  const dated = await gradeAtTradeTime(args.grader, atTradeTime, args.tradeAt, { ...args.deps, liveChart: false })
  if (!dated) return { kind: 'first_graded', tradeAt, why: 'an asset has no record on the trade date' }
  return { kind: 'trade_date', grade: dated.grade, pricedAsOf: dated.pricedAsOf, tradeAt }
}

// Pure, in its own module so the email renderer reads the same answer. Re-exported for callers here.
export { giveawayReason } from '@/lib/trade-intel/tradeGiveaway'

/**
 * THE grade for one completed ledger trade on one AF league row: the FROZEN ORIGINAL when one exists,
 * with today's re-evaluation beside it as `current` — see `frozenCompletedGrade.ts`. The first read
 * that can grade the deal freezes it.
 */
export async function oneGradeForCompletedTrade(
  leagueId: string,
  trade: GradedTrade,
  currentSeason: number,
  deps: {
    graderFor?: (leagueId: string) => Promise<LeagueTradeGrader | null>
    /** Preloaded originals (`loadFrozenCompletedGrades`), so a history of sixty trades is one read. */
    frozen?: ReadonlyMap<string, FrozenCompletedGrade>
    /** With `frozen`: collects the originals to write, so the caller saves them in one insert. */
    onFreeze?: (f: FrozenCompletedGrade) => void
    now?: Date
    tradeTime?: TradeTimeDeps
  } = {},
): Promise<TradeGradeView> {
  if (trade.sides.length !== 2 || trade.multiTeam) {
    return { graded: false, reason: 'only two-team trades are graded — one value gap cannot give three teams a letter each', basis: null }
  }
  const inputs = completedTradeInputs(trade, currentSeason)
  if (!inputs) return { graded: false, reason: 'the trade has no sides on record', basis: null }
  const grader = await (deps.graderFor ?? completedTradeGraderFor)(leagueId)
  /*
   * A Pirate STEAL before a giveaway: the same one-way shape, but in a Pirate league it is the rules
   * settling a result, not a trade — see `lib/trade-intel/pirateSteal.ts`.
   */
  const steal = pirateStealView(grader, trade)
  if (steal) return steal
  const giveaway = giveawayReason(trade)
  if (giveaway) return { graded: false, reason: giveaway, basis: null }
  const current = await gradeDeal(grader, { ...inputs, viewerSide: false })
  // The ledger's `createdIso` is Sleeper's `status_updated` — the completion time.
  const tradeAt = tradeTimeOf({ completedAt: trade.createdIso, tradeId: trade.id })
  const tradeTimeInputs = completedTradeInputsAtTradeTime(trade)
  if (deps.frozen) {
    const { view, toFreeze } = await completedOriginal({
      grader, tradeId: trade.id, inputs, tradeTimeInputs, tradeAt, current,
      frozen: deps.frozen.get(sleeperTradeKey(trade.id)), now: deps.now ?? new Date(), deps: deps.tradeTime,
    })
    if (toFreeze) {
      if (deps.onFreeze) deps.onFreeze(toFreeze)
      else await saveFrozenCompletedGrades(leagueId, [toFreeze])
    }
    return view
  }
  return frozenOriginalFor({
    afLeagueId: leagueId, tradeId: trade.id, inputs, current, now: deps.now, tradeAt: tradeAt?.toISOString() ?? null,
    priceAtTradeTime: () => gradeAtTradeTime(grader, tradeTimeInputs, tradeAt, deps.tradeTime, deps.now ?? new Date()),
  })
}

/** The withheld view for a Pirate steal, or null when this is not one. */
function pirateStealView(grader: LeagueTradeGrader | null, trade: GradedTrade): TradeGradeView | null {
  const [a, b] = trade.sides
  if (!a || !b || trade.sides.length !== 2) return null
  const sides = [
    { playersIn: a.playersIn.length, picksIn: a.picksIn.length, faabIn: a.faabIn },
    { playersIn: b.playersIn.length, picksIn: b.picksIn.length, faabIn: b.faabIn },
  ] as const
  if (!isPirateSteal({ pirateLeague: grader?.pirateLeague === true, sides })) return null
  const empty = emptySideIndex(sides)
  const [from, taker] = empty === 0 ? [a, b] : [b, a]
  return {
    graded: false,
    kind: PIRATE_STEAL_KIND,
    reason: pirateStealReason({ taker: taker.managerName, from: from.managerName }),
    basis: null,
    leagueType: grader?.leagueType ?? null,
  }
}

type ArchivedPick = {
  season: string | number | null
  round: number | null
  label: string
  /**
   * The player drafted with this pick, when the league's graded ledger resolved it
   * (`lib/core-app/archivedPickOutcomes.ts`). Absent means unknown, not unused.
   */
  drafted?: string | null
  /** That player's Sleeper id, when the ledger has it — priced by id, as `completedTradeInputs` prices him. */
  draftedId?: string | null
}

/**
 * One side of an archived trade row in the grader's terms. Unnamed players and used picks are named,
 * never zeroed.
 *
 * A used pick is graded as the player drafted with it — the same ruling, and the same order of
 * checks, as `completedTradeInputs`: the drafted player FIRST, so a current-season pick whose draft
 * has been held counts as the player and not as a still-to-come pick. It keeps its place in the
 * list (players, then picks), which is the order the board prints values in.
 */
/**
 * An archived row's player: a bare name, or the name with the Sleeper id the row keys him by (see
 * `sleeperPlayerInput` for why the id matters). The name stays REQUIRED: the pricer skips an unnamed
 * NFL player it cannot look up, which would grade a lighter side instead of withholding the letter.
 */
export type ArchivedPlayer = string | null | { name: string | null; sleeperId?: string | null; position?: string | null }

function archivedSide(players: ReadonlyArray<ArchivedPlayer>, picks: ReadonlyArray<ArchivedPick>, currentSeason: number): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const player of players) {
    const p = typeof player === 'string' || player == null ? { name: player } : player
    const name = p.name?.trim()
    if (name) out.assets.push(sleeperPlayerInput(name, 'sleeperId' in p ? p.sleeperId : null, 'position' in p ? p.position : null))
    else out.unpriceable.push('a player with no name on file')
  }
  for (const p of picks) {
    const year = Number(p.season)
    const drafted = p.drafted?.trim()
    if (drafted) out.assets.push(sleeperPlayerInput(drafted, p.draftedId))
    else if (Number.isFinite(year) && year >= currentSeason && p.round != null && p.round > 0) out.assets.push({ kind: 'pick', year, round: p.round })
    else out.unpriceable.push(p.label)
  }
  return out
}

/**
 * THE grade for one archived trade row (`LeagueTrade`), from the row's own point of view — what it
 * received against what it gave — on this league's values, without roster need. Used by the /core
 * Trades list and the cross-league board, so a trade reads the same letter on both.
 *
 * With `original` the letter is the trade's FROZEN ORIGINAL (today's re-grade rides as `current`);
 * only a caller that omits `original` gets a grade on today's values.
 */
export async function gradeArchivedTrade(
  grader: LeagueTradeGrader | null,
  args: {
    received: ReadonlyArray<ArchivedPlayer>
    gave: ReadonlyArray<ArchivedPlayer>
    picksIn: ReadonlyArray<ArchivedPick>
    picksOut: ReadonlyArray<ArchivedPick>
    currentSeason: number
    /**
     * Who the row's two sides are, for a Pirate steal's sentence ("X took this from Y"). Optional —
     * without them the steal is still named, just not who took whom.
     */
    labels?: { receiver?: string | null; partner?: string | null }
    /**
     * FAAB each way, when the caller READ it (a raw Sleeper transaction's `waiver_budget`). Absent means
     * unknown — `LeagueTrade` stores none — and then a one-way row is never called a Pirate steal, since
     * a player sold for FAAB has the same shape (Jameis Winston for $35, Pirate League twinty, week 3).
     */
    faab?: { received: number; gave: number } | null
    /**
     * Which trade this is, on which AF league row — so the letter is the trade's FROZEN ORIGINAL with
     * today's grade as `current` (see `frozenCompletedGrade.ts`). Absent: today's grade only.
     */
    original?: {
      afLeagueId: string
      tradeId: string
      /** Preloaded originals, so a list of trades is one read; absent reads this one. */
      frozen?: ReadonlyMap<string, FrozenCompletedGrade>
      /** With `frozen`: collects originals to write, so the caller saves them in one insert. */
      onFreeze?: (f: FrozenCompletedGrade) => void
      now?: Date
      /**
       * When the trade COMPLETED, when the caller has it. Absent: the Sleeper transaction id's own
       * timestamp (`tradeTimeCapture.tradeTimeOf`).
       */
      tradeAt?: string | Date | null
      tradeTime?: TradeTimeDeps
    }
  },
): Promise<TradeGradeView> {
  return (await gradeArchivedTradeWithInputs(grader, args)).grade
}

/** `gradeArchivedTrade`, with the inputs it graded — so a caller can record the grade as a receipt. */
export async function gradeArchivedTradeWithInputs(
  grader: LeagueTradeGrader | null,
  args: Parameters<typeof gradeArchivedTrade>[1],
): Promise<{ grade: TradeGradeView; give: GradeInputs; get: GradeInputs }> {
  const give = archivedSide(args.gave, args.picksOut, args.currentSeason)
  const get = archivedSide(args.received, args.picksIn, args.currentSeason)
  /*
   * A Pirate steal is not graded — and never frozen, since only a letter freezes. Only with FAAB in
   * hand: without it the one-way shape could be a FAAB sale (see `faab`).
   */
  const sides = [
    { playersIn: args.received.length, picksIn: args.picksIn.length, faabIn: args.faab?.received },
    { playersIn: args.gave.length, picksIn: args.picksOut.length, faabIn: args.faab?.gave },
  ] as const
  if (args.faab && isPirateSteal({ pirateLeague: grader?.pirateLeague === true, sides })) {
    const receiverTook = emptySideIndex(sides) === 1
    const taker = receiverTook ? args.labels?.receiver : args.labels?.partner
    const from = receiverTook ? args.labels?.partner : args.labels?.receiver
    return {
      grade: { graded: false, kind: PIRATE_STEAL_KIND, reason: pirateStealReason({ taker, from }), basis: null, leagueType: grader?.leagueType ?? null },
      give,
      get,
    }
  }
  const current = await gradeDeal(grader, { give, get, viewerSide: false })
  const o = args.original
  if (!o) return { grade: current, give, get }
  const tradeAt = tradeTimeOf({ completedAt: o.tradeAt ?? null, tradeId: o.tradeId })
  const tradeTimeInputs = {
    give: archivedSideAtTradeTime(args.gave, args.picksOut),
    get: archivedSideAtTradeTime(args.received, args.picksIn),
  }
  if (o.frozen) {
    const { view, toFreeze } = await completedOriginal({
      grader, tradeId: o.tradeId, inputs: { give, get }, tradeTimeInputs, tradeAt, current,
      frozen: o.frozen.get(sleeperTradeKey(o.tradeId)), now: o.now ?? new Date(), deps: o.tradeTime,
    })
    if (toFreeze) {
      if (o.onFreeze) o.onFreeze(toFreeze)
      else await saveFrozenCompletedGrades(o.afLeagueId, [toFreeze])
    }
    return { grade: view, give, get }
  }
  return {
    grade: await frozenOriginalFor({
      afLeagueId: o.afLeagueId, tradeId: o.tradeId, inputs: { give, get }, current, now: o.now, tradeAt: tradeAt?.toISOString() ?? null,
      priceAtTradeTime: () => gradeAtTradeTime(grader, tradeTimeInputs, tradeAt, o.tradeTime, o.now ?? new Date()),
    }),
    give,
    get,
  }
}

/**
 * An archived row's deal in the grader's terms, both ways: as a surface reads it today (a used pick
 * as the drafted player) and at the time of the trade (every pick as a pick). For the re-price job,
 * which grades stored rows exactly as `gradeArchivedTrade` would.
 */
export function archivedTradeInputs(args: {
  received: ReadonlyArray<ArchivedPlayer>
  gave: ReadonlyArray<ArchivedPlayer>
  picksIn: ReadonlyArray<ArchivedPick>
  picksOut: ReadonlyArray<ArchivedPick>
  currentSeason: number
}): { today: { give: GradeInputs; get: GradeInputs }; atTradeTime: { give: GradeInputs; get: GradeInputs } } {
  return {
    today: { give: archivedSide(args.gave, args.picksOut, args.currentSeason), get: archivedSide(args.received, args.picksIn, args.currentSeason) },
    atTradeTime: { give: archivedSideAtTradeTime(args.gave, args.picksOut), get: archivedSideAtTradeTime(args.received, args.picksIn) },
  }
}

/** An archived side AT THE TIME OF THE TRADE: every pick as the pick it was (Decision 3). */
function archivedSideAtTradeTime(players: ReadonlyArray<ArchivedPlayer>, picks: ReadonlyArray<ArchivedPick>): GradeInputs {
  const out = archivedSide(players, [], 0)
  for (const p of picks) pushPickAtTradeTime(out, p.season, p.round, p.label)
  return out
}
