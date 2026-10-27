import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { selectWhisperer } from '@/lib/zombie/whispererEngine'
import { canViewerSeeWhisperer } from '@/lib/zombie/whispererVisibility'
import { resolveLeagueAccess } from '@/lib/league-access'
import { withWhispererDisplayName } from '@/lib/zombie/zombieTeamNames'

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
    const selected = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId: z.id }, select: { id: true } })
    if (selected || !['setup', 'registering'].includes(z.status)) {
      return NextResponse.json({ error: 'Whisperer selection is locked after assignment.' }, { status: 409 })
    }
    const mode = typeof body.mode === 'string' ? body.mode : 'random'
    const manualUserId = typeof body.manualUserId === 'string' ? body.manualUserId : undefined
    const out = await selectWhisperer(z.id, mode, manualUserId)
    return NextResponse.json(out)
  }

  if (action === 'ambush') {
    return NextResponse.json({
      error: 'Use @Chimmy ambush swap <exact Survivor team name> before the provider lineup lock.',
    }, { status: 409 })
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

  // Members only, checked before the league is read.
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const z = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    include: { whispererRecord: true, coWhisperers: true, league: { select: { userId: true } } },
  })
  if (!z?.whispererRecord) return NextResponse.json({ whisperer: null, whisperers: [] })

  const isComm = z.league.userId === userId
  const records = [z.whispererRecord, ...(z.coWhisperers ?? [])]
  const visible = await Promise.all(records.map(async (record) => {
    const own = record.userId === userId
    const canSee = canViewerSeeWhisperer({
      whispererIsPublic: z.whispererIsPublic,
      isPubliclyRevealed: record.isPubliclyRevealed,
      viewerIsCommissioner: isComm,
      viewerIsWhisperer: own,
    })
    if (!canSee) return { message: 'Whisperer identity hidden this season.' }
    const named = (await withWhispererDisplayName(record))!
    return isComm || own
      ? named
      : { displayName: named.displayName, ambushesRemaining: named.ambushesRemaining, wasDefeated: named.wasDefeated }
  }))
  return NextResponse.json({ whisperer: visible[0], whisperers: visible })
}
