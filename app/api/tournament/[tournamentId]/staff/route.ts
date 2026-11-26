import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  getLegacyTournamentAccess,
  canManageStaff,
  type TournamentStaffPermissions,
} from '@/lib/tournament/legacyTournamentAccess'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizePermissions(raw: unknown): TournamentStaffPermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const keys = ['dashboard', 'manageLeagues', 'manageDrafts', 'manageChat', 'manageSettings', 'fullAdmin'] as const
  const out: TournamentStaffPermissions = {}
  for (const k of keys) {
    if (o[k] === true) out[k] = true
  }
  return out
}

/**
 * Who the creator can add as staff, found by name rather than by user id. A player already in the
 * tournament matches on part of their name or username; anyone else only on their EXACT username, so
 * the search cannot be used to browse every account. The creator and current staff are left out.
 */
async function findStaffCandidates(tournamentId: string, q: string) {
  if (q.length < 2) return []
  const [tournament, participants, staff] = await Promise.all([
    prisma.legacyTournament.findUnique({ where: { id: tournamentId }, select: { creatorId: true } }),
    prisma.legacyTournamentParticipant.findMany({ where: { tournamentId }, select: { userId: true } }),
    prisma.legacyTournamentStaff.findMany({ where: { tournamentId }, select: { userId: true } }),
  ])
  const playerIds = participants.map((p) => p.userId)
  const players = new Set(playerIds)
  const skip = new Set<string>([...staff.map((s) => s.userId), ...(tournament?.creatorId ? [tournament.creatorId] : [])])
  const users = await prisma.appUser.findMany({
    where: {
      OR: [
        { id: { in: playerIds }, OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ] },
        { username: { equals: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
    orderBy: { username: 'asc' },
    take: 12,
  })
  return users
    .filter((u) => !skip.has(u.id))
    .slice(0, 8)
    .map((u) => ({
      userId: u.id,
      displayName: u.displayName?.trim() || u.username,
      username: u.username,
      avatarUrl: u.avatarUrl ?? null,
      inTournament: players.has(u.id),
    }))
}

/** GET: List tournament staff (main commissioner only). With ?q=, the people that search finds instead. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const access = await getLegacyTournamentAccess(userId, tournamentId)
  if (!canManageStaff(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = req.nextUrl.searchParams.get('q')
  if (q != null) return NextResponse.json({ candidates: await findStaffCandidates(tournamentId, q.trim().slice(0, 64)) })

  const rows = await prisma.legacyTournamentStaff.findMany({
    where: { tournamentId },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({
    staff: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      permissions: r.permissions,
      createdAt: r.createdAt.toISOString(),
      displayName: r.user.displayName?.trim() || r.user.username || r.userId,
      username: r.user.username,
    })),
  })
}

/** POST: Upsert staff member (main commissioner only). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const access = await getLegacyTournamentAccess(userId, tournamentId)
  if (!canManageStaff(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { assigneeUserId?: string; permissions?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const assigneeUserId = body.assigneeUserId?.trim()
  if (!assigneeUserId) return NextResponse.json({ error: 'assigneeUserId required' }, { status: 400 })

  const t = await prisma.legacyTournament.findUnique({ where: { id: tournamentId }, select: { creatorId: true } })
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (assigneeUserId === t.creatorId) {
    return NextResponse.json({ error: 'Cannot assign staff to the tournament creator' }, { status: 400 })
  }

  const assignee = await prisma.appUser.findUnique({ where: { id: assigneeUserId }, select: { id: true } })
  if (!assignee) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const permissions = sanitizePermissions(body.permissions)

  const row = await prisma.legacyTournamentStaff.upsert({
    where: { tournamentId_userId: { tournamentId, userId: assigneeUserId } },
    create: { tournamentId, userId: assigneeUserId, permissions },
    update: { permissions },
    include: { user: { select: { displayName: true, username: true } } },
  })

  return NextResponse.json({ staff: row })
}

/** DELETE: Remove staff member. Query: userId */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const access = await getLegacyTournamentAccess(userId, tournamentId)
  if (!canManageStaff(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const target = req.nextUrl.searchParams.get('userId')?.trim()
  if (!target) return NextResponse.json({ error: 'userId query required' }, { status: 400 })

  await prisma.legacyTournamentStaff.deleteMany({ where: { tournamentId, userId: target } })
  return NextResponse.json({ ok: true })
}
