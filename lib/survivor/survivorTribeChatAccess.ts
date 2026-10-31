/**
 * Who may read or post in a Survivor huddle addressed as `source = tribe_<tribeId>` in league chat.
 *
 * The answer comes from the canonical access context (`survivorAccessControl.ts`): the viewer's
 * `SurvivorPlayer` row, their league role and the commissioner-participation setting. That is the
 * same rule every other Survivor read applies, so:
 *
 *   - an active manager reads their own tribe's huddle and nobody else's;
 *   - after the merge, every active manager reads the merged tribe's huddle (`isMerged`) and the
 *     old huddles close for them;
 *   - a NON-playing commissioner host reads every huddle (oversight); a PLAYING commissioner is a
 *     manager like any other;
 *   - an eliminated or exiled manager loses the huddle the moment `resolveElimination` clears
 *     `canAccessTribeChat`.
 *
 * It replaces a guard that read `SurvivorTribeChatMember` rows, which the native post-draft path
 * never writes, and that refused every tribe source once the merge triggered — so no native league
 * could open a huddle at all.
 */

import { prisma } from '@/lib/prisma'

import { parseTribeIdFromSource } from './constants'
import { canSeeSurvivorChannel, resolveSurvivorAccessContext } from './survivorAccessControl'

export async function canAccessSurvivorTribeChatSource(
  leagueId: string,
  userId: string,
  source: string | null | undefined,
): Promise<boolean> {
  if (!source) return true
  const tribeId = parseTribeIdFromSource(source)
  if (!tribeId) return true
  const [tribe, access] = await Promise.all([
    prisma.survivorTribe.findFirst({ where: { id: tribeId, leagueId }, select: { id: true, isMerged: true } }),
    resolveSurvivorAccessContext(leagueId, userId),
  ])
  if (!tribe || !access?.isLeagueMember) return false
  return canSeeSurvivorChannel(access, { channelType: tribe.isMerged ? 'merge' : 'tribe', tribeId: tribe.id })
}
