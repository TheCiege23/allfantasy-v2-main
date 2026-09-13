import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { applyAmbush, selectWhisperer } from '@/lib/zombie/whispererEngine'
import { canViewerSeeWhisperer } from '@/lib/zombie/whispererVisibility'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  const action = typeof body.action === 'string' ? body.action : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Zombie league not found' }, { status: 404 })

  if (action === 'select') {
    await requireCommissionerOnly(leagueId, userId)
    const mode = typeof body.mode === 'string' ? body.mode : 'random'
    const manualUserId = typeof body.manualUserId === 'string' ? body.manualUserId : undefined
    const out = await selectWhisperer(z.id, mode, manualUserId)
    return NextResponse.json(out)
  }

  if (action === 'ambush') {
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null
    const ambushType = typeof body.ambushType === 'string' ? body.ambushType : 'steal_winnings'
    const week = typeof body.week === 'number' ? body.week : parseInt(String(body.week), 10)
    if (!targetUserId || !Number.isFinite(week))
      return NextResponse.json({ error: 'targetUserId and week required' }, { status: 400 })
    const result = await applyAmbush(z.id, userId, targetUserId, week, ambushType)
    return NextResponse.json(result)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: { whispererRecord: true, league: { select: { userId: true } } },
  })
  if (!z?.whispererRecord) return NextResponse.json({ whisperer: null })

  const isComm = z.league.userId === userId
  const rec = z.whispererRecord
  if (isComm) return NextResponse.json({ whisperer: rec })

  // The league's secrecy setting wins over the record. `isPubliclyRevealed` defaults to true and
  // `selectWhisperer` never sets it, so on its own it revealed secret-league Whisperers.
  if (
    canViewerSeeWhisperer({
      whispererIsPublic: z.whispererIsPublic,
      isPubliclyRevealed: rec.isPubliclyRevealed,
      viewerIsCommissioner: false,
      viewerIsWhisperer: rec.userId === userId,
    })
  ) {
    return NextResponse.json({
      whisperer: {
        displayName: rec.displayName,
        ambushesRemaining: rec.ambushesRemaining,
        wasDefeated: rec.wasDefeated,
      },
    })
  }
  return NextResponse.json({
    whisperer: { message: 'Whisperer identity hidden this season.' },
  })
}

