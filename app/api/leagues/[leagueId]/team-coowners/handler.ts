import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

type Context = { params: Promise<{ leagueId: string }> }
async function actor() {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}
async function mayManage(leagueId: string, rosterId: string, actorId: string) {
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { platformUserId: true } })
  if (!roster) return false
  if (roster.platformUserId === actorId || await isCommissioner(leagueId, actorId)) return true
  return Boolean(await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: rosterId, claimedByUserId: actorId }, select: { id: true } }))
}
async function ownsTeam(leagueId: string, userId: string) {
  const [roster, team] = await Promise.all([
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId }, select: { id: true } }),
  ])
  return Boolean(roster || team)
}

export async function GET(req: NextRequest, ctx: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const rosterId = req.nextUrl.searchParams.get('rosterId')?.trim()
  if (rosterId) {
    if (!await mayManage(leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const invitations = await prisma.teamCoOwner.findMany({ where: { leagueId, rosterId }, select: { id: true, userId: true, acceptedAt: true, user: { select: { username: true, displayName: true } } }, orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ invitations })
  }
  const invitation = await prisma.teamCoOwner.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { id: true, rosterId: true, acceptedAt: true, league: { select: { name: true } } } })
  return NextResponse.json({ invitation })
}

export async function POST(req: NextRequest, ctx: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { rosterId?: unknown; username?: unknown }
  const rosterId = typeof body.rosterId === 'string' ? body.rosterId.trim() : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  if (!rosterId || !username) return NextResponse.json({ error: 'Roster and username required' }, { status: 400 })
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league || !isNativePlatform(league.platform)) return NextResponse.json({ error: 'Team co-owners are available for AllFantasy leagues' }, { status: 400 })
  if (!await mayManage(leagueId, rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const users = await prisma.appUser.findMany({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true }, take: 2 })
  if (users.length !== 1) return NextResponse.json({ error: 'Username not found or ambiguous' }, { status: 404 })
  const targetId = users[0]!.id
  if (targetId === userId || await ownsTeam(leagueId, targetId)) return NextResponse.json({ error: 'This user already manages a team in the league' }, { status: 409 })
  const [roster, team] = await Promise.all([
    prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { platformUserId: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, externalId: rosterId }, select: { claimedByUserId: true } }),
  ])
  if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
  try {
    const invitation = await prisma.teamCoOwner.create({ data: { leagueId, rosterId, userId: targetId, invitedByUserId: userId, rosterOwnerKey: roster.platformUserId, claimedOwnerId: team?.claimedByUserId ?? null }, select: { id: true } })
    return NextResponse.json({ ok: true, invitation }, { status: 201 })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return NextResponse.json({ error: 'This user already has an invitation in this league' }, { status: 409 })
    throw error
  }
}

export async function PATCH(req: NextRequest, ctx: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { action?: unknown }
  if (body.action !== 'accept') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  const invitation = await prisma.teamCoOwner.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { id: true, rosterId: true, rosterOwnerKey: true, claimedOwnerId: true, roster: { select: { leagueId: true, platformUserId: true } } } })
  if (!invitation) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  const currentTeam = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: invitation.rosterId }, select: { claimedByUserId: true } })
  if (invitation.roster.leagueId !== leagueId || invitation.roster.platformUserId !== invitation.rosterOwnerKey || (currentTeam?.claimedByUserId ?? null) !== invitation.claimedOwnerId) return NextResponse.json({ error: 'The team owner changed; request a new invitation' }, { status: 409 })
  if (await ownsTeam(leagueId, userId)) return NextResponse.json({ error: 'This user already manages a team in the league' }, { status: 409 })
  const result = await prisma.teamCoOwner.updateMany({ where: { id: invitation.id, leagueId, userId, acceptedAt: null }, data: { acceptedAt: new Date() } })
  return NextResponse.json({ ok: true, accepted: result.count === 1 })
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const userId = await actor()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'Invitation id required' }, { status: 400 })
  const invitation = await prisma.teamCoOwner.findFirst({ where: { id, leagueId }, select: { userId: true, rosterId: true } })
  if (!invitation) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  if (invitation.userId !== userId && !await mayManage(leagueId, invitation.rosterId, userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await prisma.teamCoOwner.deleteMany({ where: { id, leagueId } })
  return NextResponse.json({ ok: true })
}
