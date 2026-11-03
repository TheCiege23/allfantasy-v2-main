/**
 * [NEW] POST: Submit private eviction vote. Last vote before deadline counts. PROMPT 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { submitEvictionVote } from '@/lib/big-brother/BigBrotherVoteEngine'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const cycleId = body.cycleId
  const targetRosterId = body.targetRosterId
  if (!cycleId || !targetRosterId) {
    return NextResponse.json({ error: 'cycleId and targetRosterId required' }, { status: 400 })
  }

  const ownedRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const coOwnerRosterId = ownedRoster ? null : await acceptedCoOwnerRosterId(leagueId, userId)
  const roster = ownedRoster ?? (coOwnerRosterId ? { id: coOwnerRosterId } : null)
  if (!roster) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

  const result = await submitEvictionVote(cycleId, roster.id, targetRosterId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
