/**
 * An in-process memo of PRICED league IDP boards.
 *
 * Exists because pricing a board is the expensive half of `loadIdpValueRows`: it projects every
 * rostered defender in the league. Measured on staging 2026-09-16, that took the Decision OS trade
 * evaluator from a 570 ms median to 1,468 ms, and the trades panel grades every pending offer in a
 * league — against the same board each time.
 *
 * ⚠ A MEMO, NOT A CACHE OF RECORD. It holds the promise of a pricing for `IDP_BOARD_TTL_MS` inside
 * one process: nothing is written anywhere, nothing outlives a restart, and a minute of staleness
 * cannot move a board whose projections are rebuilt daily. It lives here rather than in the world
 * port so the port stays a plain reader (its architecture tests forbid write-shaped calls there).
 *
 * The caller owns the key and must put EVERYTHING that shapes the board in it.
 */
import type { LeagueIdpVorpResult } from './leagueIdpVorp'

export const IDP_BOARD_TTL_MS = 60_000
const IDP_BOARD_MEMO_MAX = 64

const memo = new Map<string, { at: number; board: Promise<LeagueIdpVorpResult> }>()

export function memoizedIdpBoard(
  key: string,
  price: () => Promise<LeagueIdpVorpResult>,
  now: number = Date.now(),
): Promise<LeagueIdpVorpResult> {
  const hit = memo.get(key)
  if (hit && now - hit.at <= IDP_BOARD_TTL_MS) return hit.board

  const board = price()
  // Re-inserting moves the key to the back, so eviction below drops the least recently priced.
  memo.delete(key)
  memo.set(key, { at: now, board })
  // A failed pricing must not be served to the next caller.
  board.catch(() => {
    if (memo.get(key)?.board === board) memo.delete(key)
  })
  if (memo.size > IDP_BOARD_MEMO_MAX) {
    const oldest = memo.keys().next().value
    if (oldest !== undefined) memo.delete(oldest)
  }
  return board
}

/** Test seam: forget every memoised board. */
export function clearIdpBoardMemo(): void {
  memo.clear()
}
