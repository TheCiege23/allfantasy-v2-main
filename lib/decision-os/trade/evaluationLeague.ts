import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Which AllFantasy league a trade is graded in, when the surface only has the id the CLIENT sent.
 *
 * `evaluateTrade()` trusts that its caller has proven membership (the grader reads the viewer's
 * roster and prices on the league's own rules). Surfaces built before the one engine — the legacy
 * analyzer above all — send a SLEEPER league id and authenticate by origin, so neither assumption
 * holds there. This is the gate that makes both true before a league id reaches the engine.
 *
 * ⚠ ONE SLEEPER LEAGUE IS MANY AF ROWS, ONE PER IMPORTER. Matching `platformLeagueId` alone would
 * pick an arbitrary importer's row; this matches only rows the viewer owns or has claimed a team in,
 * and prefers the viewer's own import.
 *
 * Returns null — never throws — when there is no viewer, no id, or no league of theirs by that id.
 * The engine then withholds the letter and says why.
 */
export async function resolveEvaluationLeagueId(args: {
  suppliedLeagueId: string | null | undefined
  userId: string | null | undefined
}): Promise<string | null> {
  const supplied = args.suppliedLeagueId?.trim()
  const userId = args.userId?.trim()
  if (!supplied || !userId) return null
  /*
   * ⚠ `try` AROUND THE CALL, NOT `.catch` ON ITS PROMISE. A `.catch` only sees a rejection; a delegate
   * that is missing or throws synchronously escaped it and turned a grading gap into a 500 for the
   * whole trade evaluator — found by `trade-evaluator-normalized-context.test.ts`, whose Prisma mock
   * has no `league.findMany`.
   */
  let rows: Array<{ id: string; userId: string }> = []
  try {
    rows = await prisma.league.findMany({
      where: {
        AND: [
          { OR: [{ id: supplied }, { platformLeagueId: supplied }] },
          { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
        ],
      },
      select: { id: true, userId: true },
      // Newest season first, as `resolveTradeEvaluatorInternalLeagueId` does; id breaks ties stably.
      orderBy: [{ season: 'desc' }, { id: 'asc' }],
      take: 10,
    })
  } catch {
    return null
  }
  if (rows.length === 0) return null
  return (rows.find((r) => r.id === supplied) ?? rows.find((r) => r.userId === userId) ?? rows[0]!).id
}

/**
 * The same membership gate, for a consumer keyed on the PROVIDER's league id rather than ours — the
 * trade context assembler (`lib/trade-engine/trade-context-assembler.ts`) reads manager tendencies,
 * competitor snapshots, trade history and league values `where: { platformLeagueId }`.
 *
 * 🛑 WITHOUT THIS, A CLIENT-SUPPLIED ID READ ANY LEAGUE'S DERIVED MANAGER DATA INTO AN AI PROMPT. The
 * dynasty trade analyzer passed its request's `leagueId` straight to the assembler, so a signed-in
 * caller who named another league got that league's manager preference vectors narrated back.
 *
 * Returns the verified league's `platformLeagueId`, or null — never throws — when there is no viewer,
 * no id, no league of theirs by that id, or the read fails. Null means: proceed league-blind.
 */
export async function resolveVerifiedPlatformLeagueId(args: {
  suppliedLeagueId: string | null | undefined
  userId: string | null | undefined
}): Promise<string | null> {
  const leagueId = await resolveEvaluationLeagueId(args)
  if (!leagueId) return null
  try {
    const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { platformLeagueId: true } })
    return row?.platformLeagueId?.trim() || null
  } catch {
    return null
  }
}

export const NOT_YOUR_LEAGUE_REASON =
  'This league is not one of yours on AllFantasy, so there are no league values to grade it on. Import the league to get a grade.'
