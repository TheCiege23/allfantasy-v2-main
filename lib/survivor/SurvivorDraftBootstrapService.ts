import { prisma } from '@/lib/prisma'
import { bootstrapTribeChatMembers } from './SurvivorChatMembershipService'
import { getOrCreateExileLeague } from './SurvivorExileEngine'
import { assignIdolsAfterDraft } from './SurvivorIdolRegistry'
import { getSurvivorConfig, isSurvivorLeague } from './SurvivorLeagueConfig'
import { createTribes } from './SurvivorTribeService'
import { notifyIdolAssigned } from './notificationEngine'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

function hashSeed(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash || 1
}

export interface SurvivorDraftBootstrapResult {
  isSurvivor: boolean
  exileLeagueId?: string
  tribesCreated: boolean
  idolsAssigned: number
  warnings: string[]
}

export async function runSurvivorPostDraftBootstrap(
  leagueId: string
): Promise<SurvivorDraftBootstrapResult> {
  const survivor = await isSurvivorLeague(leagueId)
  if (!survivor) {
    return {
      isSurvivor: false,
      tribesCreated: false,
      idolsAssigned: 0,
      warnings: [],
    }
  }

  const warnings: string[] = []
  const config = await getSurvivorConfig(leagueId)
  if (!config) {
    return {
      isSurvivor: true,
      tribesCreated: false,
      idolsAssigned: 0,
      warnings: ['Survivor config missing'],
    }
  }

  const exile = await getOrCreateExileLeague(leagueId).catch((error) => {
    warnings.push(error instanceof Error ? error.message : 'Failed to create exile league')
    return null
  })

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })

  let tribesCreated = false
  const existingTribeCount = await prisma.survivorTribe.count({
    where: { configId: config.configId },
  })
  if (existingTribeCount === 0 && config.tribeFormation === 'random' && rosters.length > 0) {
    const tribeResult = await createTribes(leagueId, {
      rosterIds: rosters.map((roster) => roster.id),
      formation: 'random',
      seed: hashSeed(`${leagueId}:${config.configId}:${rosters.length}`),
    })
    if (tribeResult.ok) {
      tribesCreated = true
      await bootstrapTribeChatMembers(leagueId).catch((error) => {
        warnings.push(error instanceof Error ? error.message : 'Failed to bootstrap tribe chats')
      })
    } else if (tribeResult.error !== 'Tribes already exist') {
      warnings.push(tribeResult.error ?? 'Failed to create tribes')
    }
  }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      status: true,
      picks: {
        orderBy: { overall: 'asc' },
        select: {
          overall: true,
          rosterId: true,
          playerId: true,
        },
      },
    },
  })

  let idolsAssigned = 0
  if (session?.status === 'completed') {
    const idolPairs = session.picks
      .filter((pick) => Boolean(pick.playerId))
      .map((pick) => ({
        playerId: pick.playerId as string,
        rosterId: pick.rosterId,
      }))

    if (idolPairs.length > 0) {
      const idolResult = await assignIdolsAfterDraft(leagueId, idolPairs, {
        seed: hashSeed(`${leagueId}:${session.picks.length}`),
      })
      if (idolResult.ok) {
        idolsAssigned = idolResult.assigned
        // Send private DM notifications to each idol holder
        const assignedIdols = await (prisma as any).survivorIdol.findMany({
          where: { leagueId, status: 'hidden', isUsed: false, currentOwnerUserId: { not: null } },
          select: { currentOwnerUserId: true, powerLabel: true, powerType: true, powerDesc: true },
        })
        for (const idol of assignedIdols) {
          if (idol.currentOwnerUserId) {
            await notifyIdolAssigned(leagueId, idol.currentOwnerUserId).catch(() => {})
            // Also send a private Chimmy chat message with idol details
            await (prisma as any).survivorChatMessage.create({
              data: {
                leagueId,
                channelId: `chimmy:${idol.currentOwnerUserId}`,
                channelType: 'private_ai',
                senderUserId: 'system',
                senderName: '@Chimmy',
                senderIsHost: true,
                isSystemMessage: true,
                content: `You have been secretly assigned: **${idol.powerLabel ?? idol.powerType}**\n\n${idol.powerDesc ?? 'Use it wisely.'}\n\nThis power is hidden from other players. To play it, message me during Tribal Council.`,
                contentType: 'card',
                cardData: {
                  type: 'idol_assigned',
                  powerType: idol.powerType,
                  powerLabel: idol.powerLabel,
                  powerDesc: idol.powerDesc,
                },
              },
            }).catch(() => {})
          }
        }
      } else if (idolResult.error !== 'Idols already assigned') {
        warnings.push(idolResult.error ?? 'Failed to assign idols')
      }
    } else if (config.idolCount > 0) {
      warnings.push('No player ids were available from the completed draft, so idols could not be bound to drafted players.')
    }
  }

  return {
    isSurvivor: true,
    exileLeagueId: exile?.exileLeagueId,
    tribesCreated,
    idolsAssigned,
    warnings,
  }
}
