/**
 * Resolve, for one request, whether the viewer may know a Zombie league's Whisperer, and who the
 * Whisperer is. This is the input `./whispererRedaction` needs.
 *
 * The rule itself is `canViewerSeeWhisperer`; this module only gathers its inputs. It fails
 * closed: an unreadable league or role reads as "may not see", and redaction still masks any
 * row whose status says Whisperer even when the identity could not be loaded.
 */

import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { canViewerSeeWhisperer } from './whispererVisibility'
import type { WhispererIdentity } from './whispererRedaction'

export type WhispererViewer = {
  canSee: boolean
  identity: WhispererIdentity
}

const EMPTY_IDENTITY: WhispererIdentity = { rosterIds: new Set(), userIds: new Set() }

export async function resolveWhispererViewer(leagueId: string, userId: string): Promise<WhispererViewer> {
  try {
    const [league, role, viewerRoster, whispererTeams] = await Promise.all([
      prisma.zombieLeague.findUnique({
        where: { leagueId },
        select: {
          whispererIsPublic: true,
          whispererRecord: { select: { userId: true, isPubliclyRevealed: true } },
        },
      }),
      getLeagueRole(leagueId, userId).catch(() => null),
      prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
      prisma.zombieLeagueTeam.findMany({
        where: { leagueId, OR: [{ status: 'Whisperer' }, { isWhisperer: true }] },
        select: { rosterId: true },
      }),
    ])

    const rosterIds = new Set(whispererTeams.map((team) => team.rosterId))
    const recordUserId = league?.whispererRecord?.userId ?? null
    const userIds = new Set(recordUserId ? [recordUserId] : [])
    const viewerIsWhisperer =
      (recordUserId != null && recordUserId === userId) || (viewerRoster != null && rosterIds.has(viewerRoster.id))

    return {
      canSee: canViewerSeeWhisperer({
        whispererIsPublic: league?.whispererIsPublic,
        isPubliclyRevealed: league?.whispererRecord?.isPubliclyRevealed,
        viewerIsCommissioner: role === 'commissioner',
        viewerIsWhisperer,
      }),
      identity: { rosterIds, userIds },
    }
  } catch {
    return { canSee: false, identity: EMPTY_IDENTITY }
  }
}
