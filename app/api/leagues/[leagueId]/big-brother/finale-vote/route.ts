import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { submitFinaleVote } from '@/lib/big-brother/BigBrotherJuryEngine'
import { isFinaleReached } from '@/lib/big-brother/BigBrotherFinaleService'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const finale = await isFinaleReached(leagueId)
  if (!finale) return NextResponse.json({ error: 'Finale not active' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const targetRosterId = body.targetRosterId as string | undefined
  if (!targetRosterId) return NextResponse.json({ error: 'targetRosterId required' }, { status: 400 })

  const ownedRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const coOwnerRosterId = ownedRoster ? null : await acceptedCoOwnerRosterId(leagueId, userId)
  const roster = ownedRoster ?? (coOwnerRosterId ? { id: coOwnerRosterId } : null)
  if (!roster) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

  const res = await submitFinaleVote(leagueId, roster.id, targetRosterId)
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Vote failed' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
