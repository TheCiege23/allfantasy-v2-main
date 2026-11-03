import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
/**
 * PROMPT 5: Build C2C league context for Chimmy when user is in a College-to-Canton (merged devy) league.
 * Deterministic data only. Chimmy never decides promotion, eligibility, standings, or pool assignment.
 */

import { prisma } from '@/lib/prisma'
import { isC2CLeague, getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { getC2CStandings, getC2CHybridStandings } from '@/lib/merged-devy-c2c/standings/C2CStandingsService'
import { getDevyTeamOutlook } from '@/lib/devy/rankings/DevyTeamOutlookService'
import { isDevyLeague } from '@/lib/devy'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'
import { C2C_LIFECYCLE_STATE } from '@/lib/merged-devy-c2c/types'

const PROMOTION_ELIGIBLE_STATES = [DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE, C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE] as const
const isPromotionEligibleState = (s: string) => (PROMOTION_ELIGIBLE_STATES as readonly string[]).includes(s)

export async function buildC2CContextForChimmy(
  leagueId: string,
  userId: string
): Promise<string> {
  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return ''
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)

  const [config, roster, rights, standings] = await Promise.all([
    getC2CConfig(leagueId),
    prisma.roster.findFirst({
      where: coOwnerRosterId ? { leagueId, id: coOwnerRosterId } : { leagueId, platformUserId: userId },
      select: { id: true },
    }),
    prisma.devyRights.findMany({
      where: { leagueId },
      select: { rosterId: true, state: true, devyPlayerId: true },
    }),
    getC2CStandings(leagueId).catch(() => null),
  ])

  if (!config) return ''

  const myRosterId = roster?.id
  const myRights = myRosterId ? rights.filter((r) => r.rosterId === myRosterId) : []
  const promotionEligible = myRights.filter((r) => isPromotionEligibleState(r.state)).length
  const outlook = myRosterId && (await isDevyLeague(leagueId))
    ? await getDevyTeamOutlook({ leagueId, rosterId: myRosterId })
    : null

  const parts: string[] = [
    '[C2C (COLLEGE-TO-CANTON) CONTEXT - for explanation only; you never decide promotion, eligibility, pool assignment, standings, or lineup legality]',
    `League ${leagueId}. Sport: ${config.sport}. Startup format: ${config.startupFormat}. Standings: ${config.standingsModel}. Best ball pro: ${config.bestBallPro}, college: ${config.bestBallCollege}. Promotion timing: ${config.promotionTiming}.`,
    `User's roster: ${myRosterId ?? 'N/A'}. College (devy) rights count: ${myRights.length}. Promotion-eligible: ${promotionEligible}.`,
  ]

  if (outlook) {
    parts.push(
      `Outlook: future capital score ${outlook.futureCapitalScore}, devy inventory score ${outlook.devyInventoryScore}, pro assets ${outlook.outlook.proAssetCount}, promoted this year ${outlook.outlook.promotedThisYear}.`
    )
  }

  if (config.standingsModel === 'hybrid') {
    try {
      const hybrid = await getC2CHybridStandings(leagueId)
      parts.push(
        `Hybrid standings: pro weight ${hybrid.proWeight}%, college ${hybrid.collegeWeight}%. Playoff/championship: ${hybrid.playoffQualification}, tiebreaker: ${hybrid.championshipTieBreaker}.`
      )
      const myRow = myRosterId ? hybrid.rows.find((r) => r.rosterId === myRosterId) : null
      if (myRow) {
        parts.push(
          `User's pro points: ${myRow.proPoints}, college points: ${myRow.collegePoints}, combined (weighted): ${(myRow as any).combinedPoints ?? myRow.proPoints + myRow.collegePoints}.`
        )
      }
    } catch {
      // ignore
    }
  }

  parts.push(
    'Chimmy can answer: should I promote this player, do I need more college depth, am I too old on the pro side, should I trade rookie picks for college assets, should I build for college points now or pro points later. Always explain using this context and recommend existing tools (Promotion Center, Trade Analyzer, C2C Draft Board). Do not decide outcomes.'
  )

  return parts.join(' ')
}
