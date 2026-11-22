/**
 * PROMPT 5: Build Devy league context for Chimmy when user is in a Devy Dynasty league.
 * Deterministic data only. Chimmy never decides promotion, eligibility, or pool assignment.
 */

import { viewingRosterWhere } from '@/lib/league/viewerTeams'
import { prisma } from '@/lib/prisma'
import { isDevyLeague, getDevyConfig } from '@/lib/devy/DevyLeagueConfig'
import { getDevyTeamOutlook } from '@/lib/devy/rankings/DevyTeamOutlookService'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'

export async function buildDevyContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return ''

  const myTeamWhere = await viewingRosterWhere(leagueId, userId)
  const [config, roster, rights] = await Promise.all([
    getDevyConfig(leagueId),
    prisma.roster.findFirst({
      where: myTeamWhere,
      select: { id: true },
    }),
    prisma.devyRights.findMany({
      where: { leagueId },
      select: { rosterId: true, state: true, devyPlayerId: true },
    }),
  ])
  if (!config) return ''

  const myRosterId = roster?.id
  const myRights = myRosterId ? rights.filter((r) => r.rosterId === myRosterId) : []
  const promotionEligible = myRights.filter((r) => r.state === DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE).length
  const outlook = myRosterId ? await getDevyTeamOutlook({ leagueId, rosterId: myRosterId }) : null

  const parts: string[] = [
    '[DEVY DYNASTY CONTEXT - for explanation only; you never decide promotion, eligibility, pool assignment, or lineup legality]',
    `League ${leagueId}. Sport: ${config.sport}. Best ball: ${config.bestBallEnabled}. Promotion timing: ${config.promotionTiming}.`,
    `User's roster: ${myRosterId ?? 'N/A'}. Devy rights count: ${myRights.length}. Promotion-eligible: ${promotionEligible}.`,
  ]
  if (outlook) {
    parts.push(
      `Outlook: future capital score ${outlook.futureCapitalScore}, devy inventory score ${outlook.devyInventoryScore}, pro assets ${outlook.outlook.proAssetCount}, promoted this year ${outlook.outlook.promotedThisYear}.`
    )
  }
  parts.push(
    'When the user asks who to promote, whether to trade a devy pick, if their class pipeline is healthy, or rookie vs devy capital: explain using this context and recommend existing tools (Promotion Panel, Trade Analyzer, Devy Board). Do not decide outcomes.'
  )
  return parts.join(' ')
}
