import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tournamentId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const tournamentId = body.tournamentId?.trim()
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (shell.status !== 'registering' && shell.status !== 'setup') {
    return NextResponse.json({ error: 'Registration closed' }, { status: 400 })
  }

  const count = await prisma.tournamentParticipant.count({ where: { tournamentId } })
  if (count >= shell.maxParticipants) {
    return NextResponse.json({ error: 'Tournament full' }, { status: 400 })
  }

  const existing = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  })
  if (existing) return NextResponse.json({ participant: existing })

  const [profile, user] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: { displayName: true } }),
    prisma.appUser.findUnique({ where: { id: userId }, select: { avatarUrl: true } }),
  ])
  const displayName = profile?.displayName?.trim() || `Manager ${userId.slice(0, 6)}`

  const participant = await prisma.tournamentParticipant.create({
    data: {
      tournamentId,
      userId,
      displayName,
      avatarUrl: user?.avatarUrl ?? undefined,
    },
  })

  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: { currentParticipantCount: count + 1 },
  })

  return NextResponse.json({ participant })
}

export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tournamentId = req.nextUrl.searchParams?.get('tournamentId')?.trim()
  const participantId = req.nextUrl.searchParams?.get('participantId')?.trim()
  if (!tournamentId || !participantId) {
    return NextResponse.json({ error: 'tournamentId and participantId required' }, { status: 400 })
  }

  const p = await prisma.tournamentParticipant.findFirst({
    where: { id: participantId, tournamentId },
  })
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (['blueprint', 'rules_published'].includes(shell.status)) return NextResponse.json({ error: 'Use the season tournament registration controls.' }, { status: 409 })

  const isCommissioner = shell.commissionerId === userId
  if (p.userId !== userId && !isCommissioner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isCommissioner && shell.status !== 'registering' && shell.status !== 'setup') {
    return NextResponse.json({ error: 'Cannot withdraw after draft' }, { status: 400 })
  }

  await prisma.tournamentParticipant.delete({ where: { id: participantId } })
  const remaining = await prisma.tournamentParticipant.count({ where: { tournamentId } })
  await prisma.tournamentShell.update({
    where: { id: tournamentId },
    data: { currentParticipantCount: remaining },
  })

  return NextResponse.json({ ok: true })
}

