import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { buildRedraftPlan } from '@/lib/tournament/redraftPlan'

/**
 * Where the advancing managers go next.
 *
 * ⚠ GET ONLY, AND THAT IS THE WHOLE FEATURE FOR AN IMPORTED TOURNAMENT.
 * AllFantasy cannot create a league on the host platform, so there is nothing to
 * POST: the plan is the deliverable, and the commissioner builds it there.
 * A native tournament will need an execute step that APPLIES this same plan —
 * not `executeAdvancement`, whose own assignment is random, mixes the
 * conferences and caps leagues at eight.
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

  const plan = await buildRedraftPlan(tournamentId, userId)
  if (!plan) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  return NextResponse.json(plan)
}
