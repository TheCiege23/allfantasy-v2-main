import 'server-only'

import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { createLeagueTradeGrader, gradeDeal, type LeagueTradeGrader } from './leagueTradeGrader'
import type { TradeGradeView } from './tradeGrade'
import type { GradeInputs } from './tradeGradeInputs'

/**
 * THE grade for a COMPLETED provider trade — the grade email, the /core history and the dashboard
 * band all read it from here, so a finished deal carries one letter wherever it appears.
 *
 * Graded from side one's point of view, on TODAY's league values, and WITHOUT roster need: the trade
 * has happened and both rosters already hold its result, so "does this fill a hole" has no honest
 * answer. A pick whose draft has already been held no longer exists as a pick; it withholds the
 * letter rather than being priced as though it were still to come.
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

/** What side one sent and received, in the one grader's terms. */
export function completedTradeInputs(trade: GradedTrade, currentSeason: number): { give: GradeInputs; get: GradeInputs } | null {
  const [a] = trade.sides
  if (!a) return null
  const side = (players: Side['playersIn'], picks: Side['picksIn']): GradeInputs => {
    const out: GradeInputs = { assets: players.map((p) => ({ kind: 'player' as const, name: p.name })), unpriceable: [] }
    for (const pick of picks) {
      const year = Number(pick.season)
      if (Number.isFinite(year) && year >= currentSeason && pick.round > 0) out.assets.push({ kind: 'pick', year, round: pick.round })
      else out.unpriceable.push(pick.label)
    }
    return out
  }
  return { give: side(a.playersOut, a.picksOut), get: side(a.playersIn, a.picksIn) }
}

export async function oneGradeForCompletedTrade(
  leagueId: string,
  trade: GradedTrade,
  currentSeason: number,
  deps: { graderFor?: (leagueId: string) => Promise<LeagueTradeGrader | null> } = {},
): Promise<TradeGradeView> {
  if (trade.sides.length !== 2 || trade.multiTeam) {
    return { graded: false, reason: 'only two-team trades are graded — one value gap cannot give three teams a letter each', basis: null }
  }
  const inputs = completedTradeInputs(trade, currentSeason)
  if (!inputs) return { graded: false, reason: 'the trade has no sides on record', basis: null }
  return gradeDeal(await (deps.graderFor ?? completedTradeGraderFor)(leagueId), { ...inputs, viewerSide: false })
}

type ArchivedPick = { season: string | number | null; round: number | null; label: string }

/** One side of an archived trade row in the grader's terms. Unnamed players and used picks are named, never zeroed. */
function archivedSide(players: ReadonlyArray<string | null>, picks: ReadonlyArray<ArchivedPick>, currentSeason: number): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const name of players) {
    if (name && name.trim()) out.assets.push({ kind: 'player', name: name.trim() })
    else out.unpriceable.push('a player with no name on file')
  }
  for (const p of picks) {
    const year = Number(p.season)
    if (Number.isFinite(year) && year >= currentSeason && p.round != null && p.round > 0) out.assets.push({ kind: 'pick', year, round: p.round })
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
    received: ReadonlyArray<string | null>
    gave: ReadonlyArray<string | null>
    picksIn: ReadonlyArray<ArchivedPick>
    picksOut: ReadonlyArray<ArchivedPick>
    currentSeason: number
  },
): Promise<TradeGradeView> {
  return gradeDeal(grader, {
    give: archivedSide(args.gave, args.picksOut, args.currentSeason),
    get: archivedSide(args.received, args.picksIn, args.currentSeason),
    viewerSide: false,
  })
}
