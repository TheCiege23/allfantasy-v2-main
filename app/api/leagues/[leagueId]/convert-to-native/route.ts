import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { convertImportedLeagueInPlace, NativeConversionRefusal } from '@/lib/league/convertImportedLeagueInPlace'

export const dynamic = 'force-dynamic'

/**
 * POST — switch this imported league to running on AllFantasy, in place
 * (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §7; lib/league/convertImportedLeagueInPlace.ts).
 *
 * Body: `{ "acceptWeeklyLineups": true }` is required for a baseball league (native scoring is one lineup a week).
 *
 * The league's head commissioner only (the one commissioner rule, 'head'). This was also AllFantasy-admin-only while
 * the switch was incomplete; that gate came off in step 4b-3, once native settings (4b-1), the past-week copy (4b-2)
 * and per-seat invite links (4b-3) were all in. Called by the "Switch to AllFantasy" card in the Commissioner tab
 * (components/league-home/NativeReadinessCard.tsx, step 7); undo is the card that replaces it (step 6).
 *
 * 409 = refused, with the blockers the readiness card would show; nothing was written.
 */
export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, userId, 'head')
  if (refused) return refused

  const body = (await req.json().catch(() => ({}))) as { acceptWeeklyLineups?: unknown }
  try {
    const result = await convertImportedLeagueInPlace(prisma, { leagueId, userId, acceptWeeklyLineups: body.acceptWeeklyLineups === true })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NativeConversionRefusal) {
      return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: 409 })
    }
    console.error('[convert-to-native] failed', JSON.stringify({ leagueId, error: error instanceof Error ? error.message : String(error) }))
    return NextResponse.json({ error: 'The switch did not complete, and nothing was changed. Try again, or contact support.' }, { status: 500 })
  }
}
