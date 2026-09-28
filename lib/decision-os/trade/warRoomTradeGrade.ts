import 'server-only'

import { createLeagueTradeGrader, gradeDeal } from './leagueTradeGrader'
import type { GradeInputs } from './tradeGradeInputs'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

/**
 * THE grade on the War Room's trade analyzer (2026-09-28) — redraft and dynasty.
 *
 * Both War Rooms answered "analyze this trade" with a verdict of their own — accept / reject /
 * neutral, from `redraftTradeEngine.ts` / `dynastyTradeEngine.ts` summing a private "composite" — a
 * scale no other trade screen uses. The analysis (lineup, bench, age and pick impact) stays: those are
 * facts about the deal. The VERDICT is now the one grade, taken on the league's own grader from the
 * analysed roster's side.
 *
 * Membership: both War Room contexts are built only for a league member or its commissioner, which is
 * what `createLeagueTradeGrader` requires of its caller. `viewerSide` is true only when the analysed
 * roster is the viewer's own — a commissioner analysing another team gets the chart, not their need.
 */

export type WarRoomTradeSide = {
  players: Array<{ playerId: string; name: string | null }>
  picks: Array<{ season: number | null; round: number | null; label: string }>
  /** Ids the War Room could not find on any roster. Named, never priced as zero. */
  unknown: string[]
}

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))] : []

/**
 * A side from the ids the War Room's request names, resolved against the War Room's own roster facts
 * (PURE). Anything not on a roster is `unknown` — the grade withholds and says so.
 */
export function warRoomTradeSide(args: {
  playerIds: unknown
  pickIds?: unknown
  players: ReadonlyArray<{ playerId: string; playerName: string | null }>
  picks?: ReadonlyArray<{ id: string; season: number; round: number }>
}): WarRoomTradeSide {
  const side: WarRoomTradeSide = { players: [], picks: [], unknown: [] }
  for (const id of ids(args.playerIds)) {
    const p = args.players.find((x) => x.playerId === id)
    if (p) side.players.push({ playerId: p.playerId, name: p.playerName })
    else side.unknown.push(id)
  }
  for (const id of ids(args.pickIds)) {
    const pick = args.picks?.find((x) => x.id === id)
    if (pick) side.picks.push({ season: pick.season, round: pick.round, label: `${pick.season} round ${pick.round}` })
    else side.unknown.push(id)
  }
  return side
}

/** One side as grader input (PURE — exported for the test). */
export function warRoomGradeInputs(side: WarRoomTradeSide): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const p of side.players) {
    if (p.name?.trim()) out.assets.push({ kind: 'player', playerId: p.playerId, name: p.name.trim() })
    else out.unpriceable.push('a player the league has no name for')
  }
  for (const pick of side.picks) {
    if (pick.season != null && pick.round != null) out.assets.push({ kind: 'pick', year: pick.season, round: pick.round, label: pick.label })
    else out.unpriceable.push(pick.label)
  }
  for (const id of side.unknown) out.unpriceable.push(`an asset not on any roster (${id})`)
  return out
}

export const WAR_ROOM_EMPTY_SIDE_REASON = 'Add something to both sides to grade this trade.'

/** Never throws: a grade that cannot be taken is a withheld grade with the reason. */
export async function gradeWarRoomTrade(args: {
  leagueId: string
  userId: string
  viewerSide: boolean
  outgoing: WarRoomTradeSide
  incoming: WarRoomTradeSide
}): Promise<SuggestionGrade> {
  const give = warRoomGradeInputs(args.outgoing)
  const get = warRoomGradeInputs(args.incoming)
  const count = (i: GradeInputs) => i.assets.length + i.unpriceable.length
  if (count(give) === 0 || count(get) === 0) return { graded: false, reason: WAR_ROOM_EMPTY_SIDE_REASON }
  try {
    const grader = await createLeagueTradeGrader({ leagueId: args.leagueId, userId: args.userId }).catch(() => null)
    const g = await gradeDeal(grader, { give, get, viewerSide: args.viewerSide })
    return g.graded
      ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
      : { graded: false, reason: g.reason }
  } catch {
    return { graded: false, reason: 'This trade could not be graded just now.' }
  }
}
