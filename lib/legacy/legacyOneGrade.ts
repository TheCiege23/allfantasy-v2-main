import 'server-only'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { NOT_YOUR_LEAGUE_REASON, resolveEvaluationLeagueId } from '@/lib/decision-os/trade/evaluationLeague'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import { legacyPackageGrade, type LegacyPackageGrade } from './legacyPackageGrade'

/**
 * THE trade grade for the AF Legacy page's trade tools — one grader per request, any number of deals.
 * See `./legacyPackageGrade.ts` for what these tools printed before, and why they print this now.
 *
 * ⚠ THE LEGACY PAGE SENDS A SLEEPER LEAGUE ID AND AUTHENTICATES BY ORIGIN OR BY A SLEEPER HANDLE,
 * and `createLeagueTradeGrader` trusts its caller to have proven membership (it reads the viewer's
 * roster). `resolveEvaluationLeagueId` is that proof — it returns an AllFantasy league only when the
 * signed-in user owns it or has claimed a team in it — so no league id reaches the grader without it.
 * The legacy trade analyzer and `/api/legacy/trades/check` gate their grades the same way.
 *
 * Every way the grade cannot be taken is a WITHHELD grade with its reason, never an error and never
 * a number from somewhere else: no league, no signed-in user, a league that is not theirs, a league
 * that cannot be read, a deal that cannot be priced.
 */

export const NO_LEAGUE_TO_GRADE_REASON = 'No league is selected — a grade is taken on a league’s own values and rules.'
export const SIGN_IN_TO_GRADE_REASON =
  'Sign in to AllFantasy to see the trade grade — it is taken on your own league’s values and rules.'
export const COULD_NOT_GRADE_REASON = 'This deal could not be priced just now.'

export type LegacyPackageGrader = (give: GradeInputs, get: GradeInputs) => Promise<LegacyPackageGrade>

/** The signed-in AllFantasy user, or null. Never throws. */
export async function legacySessionUserId(): Promise<string | null> {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    return session?.user?.id?.trim() || null
  } catch {
    return null
  }
}

/**
 * A grader for one league, loaded once, that grades each deal from the `give` side.
 *
 * `viewerSide` only adds roster fit beside the letter (it never changes the letter); pass true only
 * when the `give` side is proven to be the signed-in user's own roster.
 */
export async function createLegacyPackageGrader(args: {
  /** The id the client sent: a Sleeper league id or an AllFantasy one. */
  suppliedLeagueId: string | null | undefined
  userId: string | null | undefined
  viewerSide?: boolean
}): Promise<LegacyPackageGrader> {
  const withheld = (reason: string): LegacyPackageGrader => async () => ({ graded: false, reason })
  if (!args.suppliedLeagueId?.trim()) return withheld(NO_LEAGUE_TO_GRADE_REASON)
  if (!args.userId?.trim()) return withheld(SIGN_IN_TO_GRADE_REASON)
  const leagueId = await resolveEvaluationLeagueId({ suppliedLeagueId: args.suppliedLeagueId, userId: args.userId })
  if (!leagueId) return withheld(NOT_YOUR_LEAGUE_REASON)
  const grader = await createLeagueTradeGrader({ leagueId, userId: args.userId }).catch(() => null)
  const viewerSide = args.viewerSide === true
  return async (give, get) => {
    try {
      return legacyPackageGrade(await gradeDeal(grader, { give, get, viewerSide }))
    } catch {
      return { graded: false, reason: COULD_NOT_GRADE_REASON }
    }
  }
}
