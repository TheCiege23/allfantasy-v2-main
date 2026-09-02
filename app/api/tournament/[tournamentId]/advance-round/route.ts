import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { advanceToNextRound, getRoundReadiness } from '@/lib/tournament/advanceRound'

/**
 * GET  — is the next round ready, and what is still missing?
 * POST — move into it.
 *
 * ⚠ Separate from `/run-advancement`, which decides WHO advances. This moves the
 * tournament into the round they were assigned to, once its leagues exist.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const readiness = await getRoundReadiness(tournamentId, userId)
  if (!readiness) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  return NextResponse.json(readiness)
}

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const result = await advanceToNextRound({ tournamentId, commissionerUserId: userId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ...result,
    note: 'The previous round is kept — the board simply reads the new one from here.',
  })
}
