/**
 * Survivor Elimination Council: create council, close vote, eliminate, route to Exile (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { tallyVotes, getSeasonPointsFromRosterPerformance } from './SurvivorVoteEngine'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { removeRosterFromTribeChat, clearTribeChatMembersAfterMerge } from './SurvivorChatMembershipService'
import { executeQueuedShuffleForCouncil, getWeeklyEffectState } from './SurvivorEffectEngine'
import { enrollInExile } from './SurvivorExileEngine'
import { shouldJoinJury, enrollJuryMember } from './SurvivorJuryEngine'
import { isMergeTriggered, recordMerge } from './SurvivorMergeEngine'
import { grantExileAccess, grantJuryAccess } from './chatPermissionGuard'
import type { SurvivorCouncilResult } from './types'
import { voidPendingRedraftTradesForRoster } from '@/lib/redraft/voidPendingTradesForElimination'
import { notifyElimination } from '@/lib/survivor/notificationEngine'
import { publishSurvivorRedraftEvent } from '@/lib/survivor/survivorRedraftStreamHub'
import { buildScrollRevealSequence } from '@/lib/survivor/votingEngine'
import { postLeagueRevealFollowUp, postScrollRevealToTribeChat } from '@/lib/survivor/leagueChatPoster'

/**
 * Create a Elimination Council for the week. Pre-merge: pass attendingTribeId. Merge: no tribe.
 */
export async function createCouncil(
  leagueId: string,
  week: number,
  phase: 'pre_merge' | 'merge',
  attendingTribeId: string | null,
  voteDeadlineAt: Date
): Promise<{ ok: boolean; councilId?: string; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const existing = await prisma.survivorTribalCouncil.findUnique({
    where: { configId_week_councilNumber: { configId: config.configId, week, councilNumber: 1 } },
  })
  if (existing) return { ok: false, error: 'Council already exists for this week' }

  if (phase === 'pre_merge' && attendingTribeId) {
    const weeklyEffects = await getWeeklyEffectState(leagueId, week)
    if (weeklyEffects.immuneTribeIds.has(attendingTribeId)) {
      return { ok: false, error: 'This tribe has challenge immunity and cannot attend Elimination Council this week' }
    }
  }

  const council = await prisma.survivorTribalCouncil.create({
    data: {
      leagueId,
      configId: config.configId,
      week,
      councilNumber: 1,
      phase,
      attendingTribeId,
      voteDeadlineAt,
    },
  })
  return { ok: true, councilId: council.id }
}

/**
 * Close council: tally votes, apply tie-break, set eliminatedRosterId, close timestamp.
 * Returns result; caller should then call Exile enrollment and chat removal.
 */
export async function closeCouncil(
  councilId: string,
  seasonPointsSource?: { getSeasonPointsForRoster(leagueId: string, rosterId: string, throughWeek: number): Promise<number> }
): Promise<{ ok: boolean; result?: SurvivorCouncilResult; error?: string }> {
  const council = await prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
  })
  if (!council) return { ok: false, error: 'Council not found' }
  if (council.closedAt) return { ok: false, error: 'Council already closed' }

  const voteTotal = await prisma.survivorVote.count({ where: { councilId } })
  if (voteTotal > 0) {
    await buildScrollRevealSequence(councilId).catch(() => {})
  }

  const source = seasonPointsSource ?? {
    getSeasonPointsForRoster: getSeasonPointsFromRosterPerformance,
  }
  const tally = await tallyVotes(councilId, source)
  const eliminatedRosterId = tally.eliminatedRosterId ?? Object.keys(tally.votesByTarget)[0] ?? null
  if (!eliminatedRosterId) {
    await prisma.survivorTribalCouncil.update({
      where: { id: councilId },
      data: { closedAt: new Date() },
    })
    return { ok: true, result: { councilId, week: council.week, phase: council.phase as 'pre_merge' | 'merge', eliminatedRosterId: '', voteCount: tally.votesByTarget, tieBreakUsed: tally.tied } }
  }

  await prisma.survivorTribalCouncil.update({
    where: { id: councilId },
    data: {
      closedAt: new Date(),
      eliminatedRosterId,
      tieBreakSeasonPoints: tally.tieBreakSeasonPoints != null ? (tally.tieBreakSeasonPoints as object) : Prisma.JsonNull,
    },
  })

  const config = await getSurvivorConfig(council.leagueId)
  if (config) {
    await appendSurvivorAudit(council.leagueId, config.configId, 'council_closed', {
      councilId,
      week: council.week,
      eliminatedRosterId,
      voteCount: tally.votesByTarget,
      tieBreak: tally.tied,
    })
    await appendSurvivorAudit(council.leagueId, config.configId, 'eliminated', {
      rosterId: eliminatedRosterId,
      week: council.week,
    })
  }

  await removeRosterFromTribeChat(council.leagueId, eliminatedRosterId)
  await voidPendingRedraftTradesForRoster(council.leagueId, eliminatedRosterId).catch(() => {})
  await prisma.survivorTribeMember.deleteMany({
    where: { rosterId: eliminatedRosterId },
  })

  const eliminatedRoster = await prisma.roster.findUnique({
    where: { id: eliminatedRosterId, leagueId: council.leagueId },
    select: { platformUserId: true },
  })
  const leagueTeam =
    eliminatedRoster?.platformUserId != null
      ? await prisma.leagueTeam.findFirst({
          where: { leagueId: council.leagueId, platformUserId: eliminatedRoster.platformUserId },
          select: { teamName: true },
        })
      : null
  const elimLabel = leagueTeam?.teamName?.trim() || 'Eliminated player'
  const attendingTribe = council.attendingTribeId
    ? await prisma.survivorTribe.findUnique({
        where: { id: council.attendingTribeId },
        select: { name: true },
      })
    : null
  const tribeName = attendingTribe?.name?.trim() || 'Merged Tribe'

  if (council.attendingTribeId) {
    await postScrollRevealToTribeChat(
      council.leagueId,
      council.attendingTribeId,
      tribeName,
      elimLabel,
      council.week,
    ).catch(() => {})
  }
  await postLeagueRevealFollowUp(council.leagueId, tribeName, elimLabel, council.week).catch(() => {})

  await notifyElimination(council.leagueId, elimLabel, council.week).catch(() => {})
  const rss = await prisma.redraftSeason.findFirst({
    where: { leagueId: council.leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (rss) {
    publishSurvivorRedraftEvent(rss.id, {
      type: 'survivor_elimination',
      leagueId: council.leagueId,
      week: council.week,
      rosterId: eliminatedRosterId,
      preview: 'The tribe has spoken',
    })
  }
  if (eliminatedRoster?.platformUserId) {
    await enrollInExile(council.leagueId, eliminatedRosterId, eliminatedRoster.platformUserId).catch((err) => {
      console.warn('[Survivor] Exile enrollment non-fatal:', err)
    })
    await grantExileAccess(council.leagueId, eliminatedRoster.platformUserId).catch((err) => {
      console.warn('[Survivor] Exile chat grant non-fatal:', err)
    })
  }

  const joinJury = await shouldJoinJury(council.leagueId, council.week)
  if (joinJury) {
    await enrollJuryMember(council.leagueId, eliminatedRosterId, council.week).catch((err) => {
      console.warn('[Survivor] Jury enrollment non-fatal:', err)
    })
    if (eliminatedRoster?.platformUserId) {
      await grantJuryAccess(council.leagueId, eliminatedRoster.platformUserId).catch((err) => {
        console.warn('[Survivor] Jury chat grant non-fatal:', err)
      })
    }
  }

  const mergedNow = await isMergeTriggered(council.leagueId, council.week).catch(() => false)
  if (mergedNow) {
    const existingMergeAudit = await prisma.survivorAuditLog.findFirst({
      where: {
        leagueId: council.leagueId,
        eventType: 'merge',
      },
      select: { id: true },
    })
    if (!existingMergeAudit) {
      await recordMerge(council.leagueId, council.week).catch((err) => {
        console.warn('[Survivor] Merge audit non-fatal:', err)
      })
      await clearTribeChatMembersAfterMerge(council.leagueId).catch((err) => {
        console.warn('[Survivor] Tribe chat merge cleanup non-fatal:', err)
      })
    }
  } else if (council.phase === 'pre_merge') {
    await executeQueuedShuffleForCouncil(council.leagueId, council.id, council.week).catch((err) => {
      console.warn('[Survivor] Forced tribe shuffle non-fatal:', err)
    })
  }

  return {
    ok: true,
    result: {
      councilId,
      week: council.week,
      phase: council.phase as 'pre_merge' | 'merge',
      eliminatedRosterId,
      voteCount: tally.votesByTarget,
      tieBreakUsed: tally.tied,
    },
  }
}

/**
 * Get council for a week.
 */
export async function getCouncil(leagueId: string, week: number) {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return null
  return prisma.survivorTribalCouncil.findUnique({
    where: { configId_week_councilNumber: { configId: config.configId, week, councilNumber: 1 } },
    include: { votes: true },
  })
}
