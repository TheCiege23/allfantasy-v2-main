import { MAX_NATIVE_TEAMS } from '@/lib/league/teamCountLimits'
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
    where: { leagueId, claimedByUserId: { not: null } },
    select: {
      claimedByUserId: true,
      ownerName: true,
      teamName: true,
    },
    // Every claimed team: the name filter below runs after this read, so a short page here hid most of a big league.
    orderBy: { id: 'asc' },
    take: MAX_NATIVE_TEAMS * 2,
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
    const hay = `${username} ${displayName} ${t.teamName ?? ''}`.toLowerCase()
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

  // Names that start with what was typed come first.
  const starts = (r: (typeof rows)[0]) => (r.username.toLowerCase().startsWith(q) || r.displayName.toLowerCase().startsWith(q) ? 0 : 1)
  const ranked = [...dedup.values()].sort((a, b) => starts(a) - starts(b) || a.username.localeCompare(b.username))
  return NextResponse.json(ranked.slice(0, 8))
}
