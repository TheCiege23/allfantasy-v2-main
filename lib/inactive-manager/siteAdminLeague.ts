import 'server-only'

import { isSiteAdmin } from '@/lib/auth/admin'
import { prisma } from '@/lib/prisma'

/**
 * Is this league owner a site admin? A site admin's own league is a test league: Chimmy may run every
 * team in it and plays all of them, plan or no plan, so the owner can watch a whole season alone.
 *
 * Two places ask the plan question (the switch in ./inactiveManagerService.ts and what Chimmy plays in
 * ./chimmyPlayable.ts). Both read this, because answering it in one only let a 12-seat survivor
 * league hand Chimmy twelve teams and then draft instantly for one of them.
 *
 * Any failure to read the account answers no: the ordinary limits apply.
 */
export async function isSiteAdminLeagueOwner(leagueOwnerUserId: string | null | undefined): Promise<boolean> {
  if (!leagueOwnerUserId) return false
  try {
    const owner = await prisma.appUser.findUnique({ where: { id: leagueOwnerUserId }, select: { email: true, username: true } })
    return Boolean(owner && isSiteAdmin(owner))
  } catch {
    return false
  }
}
