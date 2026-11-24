import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadPartnerSettings } from './service'
import { buildPartnerNudge, type PartnerNudge } from './nudgeCopy'

export type { PartnerNudge } from './nudgeCopy'

/**
 * Is this person a head commissioner of at least one league? Same rule as
 * `lib/commissioner/permissions.ts isCommissioner`, asked across all leagues at
 * once: they own a league (`League.userId`), or their claimed team is the one the
 * source platform marked as head commissioner (not a viewer). Co-commissioners
 * are left out on purpose, as they are there.
 */
async function commissionsAnyLeague(userId: string): Promise<boolean> {
  const [owned, claimed] = await Promise.all([
    prisma.league.findFirst({ where: { userId }, select: { id: true } }),
    prisma.leagueTeam.findFirst({
      where: { claimedByUserId: userId, isCommissioner: true, role: { not: 'viewer' } },
      select: { id: true },
    }),
  ])
  return Boolean(owned || claimed)
}

/**
 * What the home card and account menu show for Partner Codes. Two cheap reads,
 * no meters recomputed: the counts are the ones the daily job already wrote on
 * the code row. Shown to commissioners, and to anyone who already has a code
 * (they may have left their last league and still earn).
 */
export async function getPartnerNudge(userId: string): Promise<PartnerNudge> {
  const code = await prisma.partnerCode.findUnique({
    where: { ownerUserId: userId },
    select: { code: true, status: true, paidSubsCount: true, activeUsersCount: true, cashUnlockedAt: true, freePlan: true },
  })
  const isCommissioner = code ? true : await commissionsAnyLeague(userId)
  const settings = await loadPartnerSettings()
  return buildPartnerNudge({ code, isCommissioner, settings })
}
