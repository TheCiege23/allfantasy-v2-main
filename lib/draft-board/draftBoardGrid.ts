/**
 * The draft board, as data.
 *
 * ⚠ THE SNAKE RULE LIVED IN THREE PLACES. `components/app/draft-room/DraftBoard.tsx`,
 * `lib/live-draft-engine/DraftOrderService.ts` and
 * `lib/live-draft-engine/keeper/KeeperDraftOrder.ts` each carried their own copy of:
 *
 *     thirdRoundReversal
 *       ? round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
 *       : round % 2 === 0
 *
 * All three are correct today. Three copies of a rule stay correct only until someone
 * fixes one of them, and a board that disagrees with the order service about which
 * direction round 3 runs is a bug nobody can see until a pick lands on the wrong manager.
 * `isRoundReversed` is that rule, once.
 *
 * Third-round reversal, spelled out because it is easy to get subtly wrong: rounds 1 and 2
 * snake normally, round 3 REPEATS round 2's direction rather than flipping, and the
 * alternation resumes from round 4. So R1 fwd, R2 rev, R3 rev, R4 fwd, R5 rev.
 */

export type DraftKind = 'snake' | 'linear'

export type DraftBoardCell = {
  round: number
  /** 1-based position within the round, in board (left-to-right) terms. */
  column: number
  /** Overall pick number, 1-based. */
  overall: number
  /** The team that owns this slot, as a 1-based draft slot. */
  slot: number
  /** "1.04" — the label managers actually speak in. */
  label: string
}

export type DraftBoardRow = {
  round: number
  /** True when this round runs right-to-left on the board. */
  reversed: boolean
  cells: DraftBoardCell[]
}

/**
 * Which rounds run backwards.
 *
 * Linear never reverses — every round runs in the same order, which is the whole point of
 * the format. Reversing it would hand the first pick of every round to a different team
 * than the league agreed.
 */
export function isRoundReversed(args: {
  round: number
  kind: DraftKind
  thirdRoundReversal?: boolean
}): boolean {
  const { round, kind, thirdRoundReversal = false } = args
  if (kind === 'linear') return false
  if (!thirdRoundReversal) return round % 2 === 0
  return round === 2 || round === 3 || (round >= 4 && round % 2 === 1)
}

/** "1.04" — zero-padded to two digits, the convention every fantasy platform uses. */
export function pickLabel(round: number, column: number): string {
  return `${round}.${String(column).padStart(2, '0')}`
}

export function buildDraftBoard(args: {
  rounds: number
  teamCount: number
  kind: DraftKind
  thirdRoundReversal?: boolean
}): DraftBoardRow[] {
  const rounds = Math.max(0, Math.floor(args.rounds))
  const teamCount = Math.max(0, Math.floor(args.teamCount))
  if (rounds === 0 || teamCount === 0) return []

  const out: DraftBoardRow[] = []
  for (let round = 1; round <= rounds; round++) {
    const reversed = isRoundReversed({ round, kind: args.kind, thirdRoundReversal: args.thirdRoundReversal })
    const cells: DraftBoardCell[] = []
    for (let column = 1; column <= teamCount; column++) {
      /*
       * `column` is the board position; `slot` is whose pick it is. In a reversed round the
       * team in board column 1 is the team holding the LAST slot. Keeping these as separate
       * fields is what lets the board render columns in a stable left-to-right order —
       * one manager per column all the way down — while the pick numbers snake.
       */
      const slot = reversed ? teamCount - column + 1 : column
      cells.push({
        round,
        column,
        overall: (round - 1) * teamCount + column,
        slot,
        label: pickLabel(round, column),
      })
    }
    out.push({ round, reversed, cells })
  }
  return out
}

/**
 * The board is rendered one column per MANAGER, not one column per pick position, so a
 * reader can follow a single manager down the page. This maps a manager's draft slot to
 * the cell they own in a given round.
 */
export function cellForSlot(row: DraftBoardRow, slot: number): DraftBoardCell | null {
  return row.cells.find((c) => c.slot === slot) ?? null
}
