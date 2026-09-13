/**
 * Server-side: the league facts `executeAIAction` needs to describe a staged action honestly —
 * the league's platform (for Write Authority) and, for an imported league, the host-platform
 * link where the change actually has to be made.
 *
 * One narrow League read. Never calls a provider and never throws: an unreadable league returns
 * null, and the staged message then makes no claim about where a submit would land.
 *
 * Kept out of the `@/lib/chimmy-actions` barrel on purpose — client components import that.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import {
  sourceLinkActionForScope,
  type ActionLeagueWrite,
  type AIActionWriteScope,
} from './AIActionWriteScope'

export async function resolveActionLeagueWrite(
  leagueId: string | null | undefined,
  scope: AIActionWriteScope,
): Promise<ActionLeagueWrite | null> {
  const id = (leagueId ?? '').trim()
  if (!id || scope === null) return null
  try {
    const league = await prisma.league.findUnique({
      where: { id },
      select: { platform: true, platformLeagueId: true, name: true, season: true },
    })
    if (!league) return null
    const sourceLink =
      resolveWriteAuthority(league.platform) === 'SHADOW'
        ? resolveSourceLink({
            platform: league.platform,
            sourceLeagueId: league.platformLeagueId,
            leagueName: league.name,
            season: league.season,
            action: sourceLinkActionForScope(scope),
          })
        : null
    return { platform: league.platform ?? null, sourceLink }
  } catch {
    return null
  }
}
