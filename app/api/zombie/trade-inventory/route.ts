import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = new URL(req.url).searchParams.get('leagueId')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z || z.sport !== 'NFL') return NextResponse.json({ error: '2025 NFL Zombie item trades only' }, { status: 400 })
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: z.season } })
  if (!season) return NextResponse.json({ error: 'Draft and season must be ready first.' }, { status: 409 })
  const [rosters, teams, links] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { seasonId: season.id }, include: { players: { where: { droppedAt: null } } } }),
    prisma.zombieLeagueTeam.findMany({ where: { leagueId }, include: { items: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
  ])
  return NextResponse.json({ seasonId: season.id, myRosterId: rosters.find(r => r.ownerId === session.user!.id)?.id ?? null,
    teams: rosters.map(r => {
      const link = links.find(l => l.redraftRosterId === r.id) ?? links.find(l => l.platformUserId === r.ownerId)
      const team = teams.find(t => t.rosterId === link?.id)
      return { rosterId: r.id, name: r.teamName || 'League team', canTrade: Boolean(team && team.status !== 'Zombie'),
        // No Whisperer identity or private action history in a partner's inventory.
        items: (team?.items ?? []).filter(i => !i.isUsed && !i.isExpired && i.activationState === 'ready' && (i.itemType.includes('serum') || (z.experienceMode !== 'simple' && i.itemType.startsWith('weapon_')))).map(i => ({ id: i.id, name: i.itemLabel })),
        players: r.players.map(p => ({ id: p.playerId, name: p.playerName })),
      }
    }) })
}
