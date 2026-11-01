import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeSourcePlatform } from '@/lib/league-links/sourceLinkResolver'
import { fantraxSourceLeagueIds, linkableSourceLeagueId } from '@/lib/league-links/resolveSourceLinkForLeague'
import { handoffFor, type PlatformLink } from './platformLinks'

type ShellLeague = {
  id: string
  platform: string | null | undefined
  platformLeagueId?: string | null
  season?: number | string | null
  name?: string | null
}

/**
 * Where the open imported league's lineup is changed — the Updates menu's "Fix lineup in Sleeper ↗".
 *
 * That menu used to say "Make lineup changes on your league's platform" and stop, so the one place in
 * the chrome that admits AllFantasy is read-only left the user to find the screen themselves. This is
 * `handoffFor(…, 'lineup')`: the platform's verified lineup screen, else its verified league page
 * (labelled as such), else nothing — never a homepage under a "lineup" label.
 *
 * Two reads, both the viewer's own: their claimed team (ESPN and Yahoo need the team id in the URL)
 * and, for Fantrax, Fantrax's own league id — `League.platformLeagueId` holds a local uuid there (see
 * `fantraxSourceLeagueIds`). No provider call. Any failure is "no button", never a broken page.
 */
export async function shellLineupHandoff(userId: string, league: ShellLeague): Promise<PlatformLink | null> {
  const platform = normalizeSourcePlatform(league.platform)
  if (!platform) return null
  const [team, fantraxIds] = await Promise.all([
    prisma.leagueTeam
      .findFirst({ where: { leagueId: league.id, claimedByUserId: userId }, select: { externalId: true } })
      .catch(() => null),
    // The same mapping the League-row loaders use (resolveSourceLinkForLeague.ts); empty for non-Fantrax.
    fantraxSourceLeagueIds([{ platform: league.platform, platformLeagueId: league.platformLeagueId }]),
  ])
  const platformLeagueId = linkableSourceLeagueId(
    { platform: league.platform, platformLeagueId: league.platformLeagueId },
    fantraxIds,
  )
  return handoffFor(
    {
      id: league.id,
      platform: league.platform,
      platformLeagueId,
      season: league.season ?? null,
      name: league.name ?? null,
      teamId: team?.externalId != null ? String(team.externalId) : null,
    },
    'lineup',
  )
}
