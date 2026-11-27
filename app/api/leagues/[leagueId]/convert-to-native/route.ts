import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/adminAuth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { convertImportedLeagueInPlace, NativeConversionRefusal } from '@/lib/league/convertImportedLeagueInPlace'

export const dynamic = 'force-dynamic'

/**
 * POST — switch this imported league to running on AllFantasy, in place
 * (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §7; lib/league/convertImportedLeagueInPlace.ts).
 *
 * Body: `{ "acceptWeeklyLineups": true }` is required for a baseball league (native scoring is one lineup a week).
 *
 * 🛑 ADMIN-GATED ON PURPOSE (step 4a). The switch rewrites every id in the league and stops its sync; settings and
 * scoring scaffolding, the past-score copy and per-seat invites arrive in 4b. Until then a conversion is a supervised
 * pilot (plan §8): the caller must be the league's head commissioner AND an AllFantasy admin. Remove the admin check
 * only together with 4b, never on its own.
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
  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: 'Switching a league to AllFantasy is in a supervised pilot. Contact AllFantasy support.' }, { status: 403 })

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
