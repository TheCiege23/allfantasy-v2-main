/**
 * The commissioner's "lock all moves" (`League.lockAllMoves`) on the redraft trade path.
 *
 * 🛑 WHY THIS EXISTS. The NFL redraft runtime refuses a proposal under the lock (`MOVE_LOCKED`, in
 * `validateNflRedraftTradeProposal`), and the AF league trade engine refuses trades under it
 * (`tradeSettingsResolver.ts`: `tradesAllowed = !league.lockAllMoves`). The redraft path did not hold it
 * everywhere: the ownership fallback in `tradeProposalValidation.ts` checked only the deadline, and
 * `/api/redraft/trade-votes` never read the lock at all — for any sport — so a proposal made before the
 * commissioner locked the league could still be accepted, approved or voted through, and settled.
 *
 * ⚠ THE CODE IS THE NFL RUNTIME'S, NOT A NEW ONE. A client that already handles `MOVE_LOCKED` from an NFL
 * proposal handles every other refusal the lock now produces, whatever the sport or the step.
 *
 * Reads the column directly, like the AF engine. A league that cannot be found is not locked here: every
 * caller has already resolved the league or proposal it acts on, and refuses a missing one itself.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const REDRAFT_MOVES_LOCKED_CODE = 'MOVE_LOCKED' as const

export const REDRAFT_MOVES_LOCKED_MESSAGE =
  'The commissioner has locked all roster moves in this league. Trades cannot be proposed, accepted or processed until the lock is lifted.'

/** The same lock on a redraft lineup, IR or waiver-claim write (the routes beside the AF engine's own refusal). */
export const REDRAFT_ROSTER_MOVES_LOCKED_MESSAGE =
  'The commissioner has locked all roster moves in this league. Lineup, IR and waiver moves are paused until the lock is lifted.'

/** HTTP status for a lock refusal on the redraft routes: the request is valid, the league state forbids it. */
export const REDRAFT_MOVES_LOCKED_STATUS = 409

type MoveLockDb = Pick<PrismaClient, 'league'>

export async function isRedraftLeagueMovesLocked(leagueId: string, db: MoveLockDb = prisma): Promise<boolean> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { lockAllMoves: true } })
  return league?.lockAllMoves === true
}
