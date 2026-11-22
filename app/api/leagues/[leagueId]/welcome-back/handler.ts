/**
 * GET — the signed-in owner's welcome-back summary in this league (lib/inactive-manager/welcomeBack.ts):
 * what AllFantasy did while it ran their team, for a return in the last 7 days. `{ welcomeBack: null }`
 * when there is none. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readWelcomeBack } from '@/lib/inactive-manager/welcomeBackService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const welcomeBack = await readWelcomeBack(leagueId, userId)
  return NextResponse.json({ welcomeBack }, { headers: { 'Cache-Control': 'private, no-store' } })
}
