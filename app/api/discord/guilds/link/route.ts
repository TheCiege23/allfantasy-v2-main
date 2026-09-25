import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { linkVerifiedGuild, verifyGuildManager } from '@/lib/discord/guild-access'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    leagueId?: string
    guildId?: string
    guildName?: string | null
  } | null

  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const guildId = typeof body?.guildId === 'string' ? body.guildId.trim() : ''

  if (!leagueId || !guildId) {
    return NextResponse.json({ error: 'leagueId and guildId required' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league || league.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const manager = await verifyGuildManager(session.user.id, guildId)
  if (!manager) return NextResponse.json({ error: 'Connect your Discord account and verify Manage Server access.' }, { status: 403 })
  if (!(await linkVerifiedGuild(session.user.id, guildId, manager.guildName))) {
    return NextResponse.json({ error: 'Server is already linked by another account.' }, { status: 409 })
  }

  return NextResponse.json({ success: true })
}
