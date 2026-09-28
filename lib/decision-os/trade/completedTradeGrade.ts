import 'server-only'

import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from './leagueTradeGrader'
import type { TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import {
  frozenOriginalFor,
  saveFrozenCompletedGrades,
  sleeperTradeKey,
  withFrozenOriginal,
  type FrozenCompletedGrade,
} from './frozenCompletedGrade'

/**
 * THE grade for a COMPLETED provider trade — the grade email, the /core history and the dashboard
 * band all read it from here, so a finished deal carries one letter wherever it appears.
 *
 * Graded from side one's point of view, on TODAY's league values, and WITHOUT roster need: the trade
 * has happened and both rosters already hold its result, so "does this fill a hole" has no honest
 * answer.
 *
 * 🛑 A USED PICK IS GRADED AS THE PLAYER DRAFTED WITH IT (Guap's ruling, 2026-09-25). Once its draft
 * is held a pick no longer exists as a pick: pricing it as one priced a 2026 pick off a February
 * board months after the rookies were taken, and an older used pick withheld the letter outright.
 * The pick became a player, and that player's value today is what the pick is worth. Only a pick the
 * draft results cannot resolve, and whose season has passed, still withholds.
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
  const side = (players: Side['playersIn'], picks: Side['picksIn']): GradeInputs => {
    const out: GradeInputs = { assets: players.map((p) => sleeperPlayerInput(p.name, p.playerId, p.position)), unpriceable: [] }
    for (const pick of picks) {
      const year = Number(pick.season)
      // Used: the draft resolved it to a player. Checked FIRST — a current-season pick is used too.
      const drafted = pick.resolved?.name?.trim()
      if (drafted) out.assets.push(sleeperPlayerInput(drafted, pick.resolved?.playerId, pick.resolved?.position))
      else if (Number.isFinite(year) && year >= currentSeason && pick.round > 0) out.assets.push({ kind: 'pick', year, round: pick.round })
      else out.unpriceable.push(pick.label)
    }
    return out
  }
  return { give: side(a.playersOut, a.picksOut), get: side(a.playersIn, a.picksIn) }
}

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
  } = {},
): Promise<TradeGradeView> {
  if (trade.sides.length !== 2 || trade.multiTeam) {
    return { graded: false, reason: 'only two-team trades are graded — one value gap cannot give three teams a letter each', basis: null }
  }
  const inputs = completedTradeInputs(trade, currentSeason)
  if (!inputs) return { graded: false, reason: 'the trade has no sides on record', basis: null }
  const current = await gradeDeal(await (deps.graderFor ?? completedTradeGraderFor)(leagueId), { ...inputs, viewerSide: false })
  if (deps.frozen) {
    const { view, toFreeze } = withFrozenOriginal({
      tradeId: trade.id, inputs, current, frozen: deps.frozen.get(sleeperTradeKey(trade.id)), now: deps.now ?? new Date(),
    })
    if (toFreeze) {
      if (deps.onFreeze) deps.onFreeze(toFreeze)
      else await saveFrozenCompletedGrades(leagueId, [toFreeze])
    }
    return view
  }
  return frozenOriginalFor({ afLeagueId: leagueId, tradeId: trade.id, inputs, current, now: deps.now })
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
 * received against what it gave — on today's league values, without roster need. Used by the /core
 * Trades list and the cross-league board, so a trade reads the same letter on both.
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
  const current = await gradeDeal(grader, { give, get, viewerSide: false })
  const o = args.original
  if (!o) return { grade: current, give, get }
  if (o.frozen) {
    const { view, toFreeze } = withFrozenOriginal({
      tradeId: o.tradeId, inputs: { give, get }, current, frozen: o.frozen.get(sleeperTradeKey(o.tradeId)), now: o.now ?? new Date(),
    })
    if (toFreeze) {
      if (o.onFreeze) o.onFreeze(toFreeze)
      else await saveFrozenCompletedGrades(o.afLeagueId, [toFreeze])
    }
    return { grade: view, give, get }
  }
  return { grade: await frozenOriginalFor({ afLeagueId: o.afLeagueId, tradeId: o.tradeId, inputs: { give, get }, current, now: o.now }), give, get }
}
