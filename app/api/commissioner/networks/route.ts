import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function userId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user?.id ?? null
}

function parseInput(raw: unknown): { name: string; leagueIds: string[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 100 || !Array.isArray(body.leagueIds)) return null
  const leagueIds = [...new Set(body.leagueIds)]
  if (leagueIds.length < 1 || leagueIds.length > 50 || !leagueIds.every((id) => typeof id === 'string' && id.length > 0)) return null
  return { name, leagueIds: leagueIds as string[] }
}

async function ownsEveryLeague(ownerUserId: string, leagueIds: string[]): Promise<boolean> {
  return (await prisma.league.count({ where: { id: { in: leagueIds }, userId: ownerUserId } })) === leagueIds.length
}

async function alreadyLinked(leagueIds: string[], exceptNetworkId?: string): Promise<boolean> {
  return (await prisma.commissionerNetworkMember.count({
    where: { leagueId: { in: leagueIds }, ...(exceptNetworkId ? { networkId: { not: exceptNetworkId } } : {}) },
  })) > 0
}

export async function GET() {
  const ownerUserId = await userId()
  if (!ownerUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [ownedLeagues, networks] = await Promise.all([
    prisma.league.findMany({ where: { userId: ownerUserId }, select: { id: true, name: true, sport: true }, orderBy: { createdAt: 'desc' } }),
    prisma.commissionerNetwork.findMany({ where: { ownerUserId }, include: { members: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
  ])
  const leagueById = new Map(ownedLeagues.map((league) => [league.id, league]))
  const validIds = [...new Set(networks.flatMap((network) => network.members.map((member) => member.leagueId)))].filter((id) => leagueById.has(id))
  const [tasks, history] = validIds.length ? await Promise.all([
    prisma.commissionerWorkspaceTask.findMany({
      where: { leagueId: { in: validIds }, status: { in: ['open', 'snoozed'] } },
      select: { id: true, leagueId: true, title: true, priority: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 200,
    }),
    prisma.auditFeedEntry.findMany({
      where: { leagueId: { in: validIds } },
      select: { id: true, leagueId: true, type: true, summary: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' }, take: 200,
    }),
  ]) : [[], []]

  return NextResponse.json({
    eligibleLeagues: ownedLeagues,
    networks: networks.map((network) => {
      const members = network.members.filter((member) => leagueById.has(member.leagueId))
        .map((member) => ({ ...member, league: leagueById.get(member.leagueId) }))
      const ids = new Set(members.map((member) => member.leagueId))
      return {
        id: network.id, name: network.name, ownerUserId: network.ownerUserId, members,
        queue: tasks.filter((task) => ids.has(task.leagueId)).slice(0, 25),
        history: history.filter((event) => event.leagueId && ids.has(event.leagueId)).slice(0, 25),
      }
    }),
  })
}

export async function POST(req: Request) {
  const ownerUserId = await userId()
  if (!ownerUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseInput(await req.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'Name and 1–50 league IDs are required' }, { status: 400 })
  if (!(await ownsEveryLeague(ownerUserId, parsed.leagueIds))) return NextResponse.json({ error: 'You must own every linked league' }, { status: 403 })
  if (await alreadyLinked(parsed.leagueIds)) return NextResponse.json({ error: 'A league already belongs to a commissioner network' }, { status: 409 })
  try {
  const network = await prisma.commissionerNetwork.create({
    data: {
      ownerUserId, name: parsed.name,
      members: { create: parsed.leagueIds.map((leagueId, index) => ({ leagueId, role: index === 0 ? 'host' : 'member' })) },
    },
    select: { id: true },
  })
  return NextResponse.json(network, { status: 201 })
  } catch { return NextResponse.json({ error: 'Could not create network; a league may already be linked' }, { status: 409 }) }
}

export async function PATCH(req: Request) {
  const ownerUserId = await userId()
  if (!ownerUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const networkId = typeof body?.networkId === 'string' ? body.networkId : ''
  const parsed = parseInput(body)
  if (!networkId || !parsed) return NextResponse.json({ error: 'Invalid network update' }, { status: 400 })
  const network = await prisma.commissionerNetwork.findFirst({ where: { id: networkId, ownerUserId }, select: { id: true } })
  if (!network) return NextResponse.json({ error: 'Network not found' }, { status: 404 })
  if (!(await ownsEveryLeague(ownerUserId, parsed.leagueIds))) return NextResponse.json({ error: 'You must own every linked league' }, { status: 403 })
  if (await alreadyLinked(parsed.leagueIds, networkId)) return NextResponse.json({ error: 'A league already belongs to another commissioner network' }, { status: 409 })
  try {
  await prisma.$transaction(async (tx) => {
    await tx.commissionerNetwork.update({ where: { id: networkId }, data: { name: parsed.name } })
    await tx.commissionerNetworkMember.deleteMany({ where: { networkId } })
    await tx.commissionerNetworkMember.createMany({ data: parsed.leagueIds.map((leagueId, index) => ({ networkId, leagueId, role: index === 0 ? 'host' : 'member' })) })
  })
  return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ error: 'Could not update network; a league may already be linked' }, { status: 409 }) }
}

export async function DELETE(req: Request) {
  const ownerUserId = await userId()
  if (!ownerUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { networkId?: string } | null
  if (!body?.networkId) return NextResponse.json({ error: 'Missing networkId' }, { status: 400 })
  const deleted = await prisma.commissionerNetwork.deleteMany({ where: { id: body.networkId, ownerUserId } })
  return NextResponse.json({ ok: deleted.count === 1 }, { status: deleted.count === 1 ? 200 : 404 })
}
