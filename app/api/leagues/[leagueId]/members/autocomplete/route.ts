import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (req.nextUrl.searchParams?.get('q') ?? '').trim().toLowerCase()
  if (q.length < 1) return NextResponse.json([])

  const teams = await prisma.leagueTeam.findMany({
    /* Keyed on the claim — `isOrphan` conflates vacancy, elimination, removal and departure. */
    where: { leagueId, claimedByUserId: { not: null } },
    select: {
      claimedByUserId: true,
      ownerName: true,
      teamName: true,
    },
    take: 48,
  })

  const uidList = [...new Set(teams.map((t) => t.claimedByUserId).filter(Boolean))] as string[]
  const users = await prisma.appUser.findMany({
    where: { id: { in: uidList } },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  })
  const userById = new Map(users.map((u) => [u.id, u]))

  const rows: { username: string; displayName: string; avatarUrl?: string }[] = []
  for (const t of teams) {
    const uid = t.claimedByUserId
    if (!uid || uid === userId) continue
    const u = userById.get(uid)
    const username = (u?.username ?? '').trim()
    const displayName = (u?.displayName ?? t.ownerName ?? t.teamName ?? 'Manager').trim()
    if (!username) continue
    const hay = `${username} ${displayName}`.toLowerCase()
    if (!hay.includes(q) && !username.toLowerCase().startsWith(q) && !displayName.toLowerCase().startsWith(q)) {
      continue
    }
    rows.push({
      username,
      displayName,
      avatarUrl: u?.avatarUrl ?? undefined,
    })
  }

  const dedup = new Map<string, (typeof rows)[0]>()
  for (const r of rows) {
    if (!dedup.has(r.username.toLowerCase())) dedup.set(r.username.toLowerCase(), r)
  }

  return NextResponse.json([...dedup.values()].slice(0, 8))
}
