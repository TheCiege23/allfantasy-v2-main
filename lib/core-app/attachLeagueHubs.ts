import 'server-only'
import { prisma } from '@/lib/prisma'
import type { LeagueHub } from './leagueHubGroups'

type HubLeague = { id: string; name: string; platform: string; href?: string; hub?: LeagueHub }

/** Resolve owned memberships once for every navigation surface, including legacy Fantrax IDs. */
export async function attachLeagueHubs(userId: string, leagues: HubLeague[]): Promise<void> {
  const links = await prisma.franchiseLink.findMany({ where: { ownerUserId: userId }, include: { members: true } }).catch(() => [])
  if (!links.length) return
  const resolved = await Promise.all([
    prisma.league.findMany({ where: { userId }, select: { id: true, platform: true, platformLeagueId: true } }),
    prisma.fantraxLeague.findMany({ where: { appUserId: userId }, select: { id: true, sourceLeagueId: true } }),
  ]).catch(() => null)
  if (!resolved) return
  const [mirrors, snapshots] = resolved
  for (const link of links) {
    const members: HubLeague[] = []
    for (const member of link.members) {
      const platform = member.platform.toLowerCase()
      const ids = new Set([member.leagueId])
      // Expand both directions so a mirror, snapshot, or provider ID reaches the same league.
      for (let pass = 0; pass < 3; pass++) {
        for (const mirror of mirrors) if (mirror.platform?.toLowerCase() === platform && (ids.has(mirror.id) || (mirror.platformLeagueId && ids.has(mirror.platformLeagueId)))) {
          ids.add(mirror.id)
          if (mirror.platformLeagueId) ids.add(mirror.platformLeagueId)
        }
        if (platform === 'fantrax') for (const snapshot of snapshots) if (ids.has(snapshot.id) || (snapshot.sourceLeagueId && ids.has(snapshot.sourceLeagueId))) {
          ids.add(snapshot.id)
          if (snapshot.sourceLeagueId) ids.add(snapshot.sourceLeagueId)
        }
      }
      const match = leagues.find((league) => league.platform.toLowerCase() === platform && (ids.has(league.id) || (league.href && ids.has(new URL(league.href, 'https://allfantasy.ai').searchParams.get('league') ?? ''))))
      if (match && !members.includes(match)) members.push(match)
    }
    if (members.length < 2) continue
    members.sort((a, b) => a.id.localeCompare(b.id))
    const hub: LeagueHub = { id: link.id, name: link.name, members: members.map((m) => ({ id: m.id, name: m.name, platform: m.platform, href: m.href ?? '/core?league=' + encodeURIComponent(m.id) })) }
    for (const member of members) member.hub = hub
  }
}
