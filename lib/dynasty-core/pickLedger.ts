/**
 * The Dynasty Era "pick ledger" view of the league pick board (`./leaguePickBoard.ts`).
 *
 * Pure, and it adds no data: it only narrows the board to the next drafts the ledger shows and
 * derives the one sentence the ledger may say about it. Every number comes from the board, which
 * comes from the same pick inventory the Trade Center and the rookie draft use.
 */
import type { BoardTeam, LeaguePickBoard } from './leaguePickBoard'

/** The ledger shows the next three drafts, as the mockup and the dynasty owner's planning horizon do. */
export const PICK_LEDGER_DRAFTS = 3

/** The earliest `limit` upcoming seasons on the board. */
export function pickLedgerSeasons(board: Pick<LeaguePickBoard, 'seasons'>, limit = PICK_LEDGER_DRAFTS): number[] {
  return [...board.seasons].sort((a, b) => a - b).slice(0, Math.max(0, limit))
}

/** Picks a team holds, and how many are first-rounders, within the ledger's seasons only. */
export function pickLedgerTotals(team: Pick<BoardTeam, 'bySeason'>, seasons: readonly number[]): { held: number; firsts: number } {
  let held = 0
  let firsts = 0
  for (const s of seasons) {
    for (const p of team.bySeason[s] ?? []) {
      held += 1
      if (p.round === 1) firsts += 1
    }
  }
  return { held, firsts }
}

export type PickLedgerInsight = { team: string; firsts: number; drafts: number }

/**
 * The team holding the most first-round picks across the ledger's drafts — said only when it is a
 * fact worth saying: the board lists every pick (`complete`), one team strictly leads, and that team
 * holds more firsts than its own allotment (one per draft), so it has actually gathered capital.
 * Otherwise `null` and the ledger says nothing.
 */
export function pickLedgerInsight(board: LeaguePickBoard, seasons: readonly number[]): PickLedgerInsight | null {
  if (board.coverage !== 'complete' || seasons.length === 0) return null
  const ranked = board.teams
    .map((t) => ({ team: t.name, firsts: pickLedgerTotals(t, seasons).firsts }))
    .sort((a, b) => b.firsts - a.firsts)
  const [top, next] = ranked
  if (!top || top.firsts <= seasons.length) return null
  if (next && next.firsts === top.firsts) return null
  return { team: top.team, firsts: top.firsts, drafts: seasons.length }
}
