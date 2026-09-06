import { prisma } from '@/lib/prisma'
import type { CarryoverResult } from './types'

export async function executeSeasonCarryover(
  leagueId: string,
  outgoingSeasonId: string,
  incomingSeasonId: string,
): Promise<CarryoverResult> {
  const incomingRosters = await prisma.redraftRoster.findMany({
    where: { leagueId, seasonId: incomingSeasonId },
  })
  const keepers = await prisma.keeperRecord.findMany({
    where: { leagueId, seasonId: incomingSeasonId, status: 'locked' },
  })

  const byTeam: CarryoverResult['byTeam'] = []
  let totalKept = 0

  for (const roster of incomingRosters) {
    const teamKeepers = keepers.filter((k) => k.rosterId === roster.id)
    const keptPlayers: string[] = []
    const forfeited: string[] = []

    for (const k of teamKeepers) {
      await prisma.redraftRosterPlayer.create({
        data: {
          rosterId: roster.id,
          playerId: k.playerId,
          playerName: k.playerName,
          position: k.position,
          team: k.team,
          sport: k.sport,
          slotType: 'bench',
          acquisitionType: k.acquisitionType,
          isKept: true,
        },
      })
      keptPlayers.push(k.playerName)
      totalKept += 1

      // Round-cost keepers give up that round's pick in the rookie draft.
      // `getKeeperDraftOrder` (lib/keeper/draftIntegration.ts) already reads
      // this table and expects exactly this shape — it just never had a
      // writer, so a dynasty league's forfeited-pick count always read zero
      // regardless of keeper cost rules. Auction-cost keepers (`costRound`
      // null) pay auction dollars instead of a pick, so no round is forfeited.
      if (k.costRound != null) {
        await prisma.keeperPickAdjustment.create({
          data: {
            leagueId,
            seasonId: incomingSeasonId,
            rosterId: roster.id,
            keeperRecordId: k.id,
            pickRoundForfeited: k.costRound,
            reason: `Keeper: ${k.playerName}`,
          },
        })
        forfeited.push(k.playerName)
      }
    }

    byTeam.push({
      teamName: roster.teamName,
      keptPlayers,
      forfeited,
    })
  }

  if (incomingRosters.length > 0) {
    await prisma.keeperAuditLog.create({
      data: {
        leagueId,
        seasonId: incomingSeasonId,
        rosterId: incomingRosters[0].id,
        action: 'carryover_complete',
        detail: { outgoingSeasonId, totalKept },
        performedBy: 'system',
      },
    })
  }

  return { totalKept, byTeam }
}
