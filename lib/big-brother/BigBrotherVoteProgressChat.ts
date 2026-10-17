/**
 * Live-updating league chat line for eviction vote progress (same message row edited in place).
 */

import { prisma } from '@/lib/prisma'
import { createLeagueChatMessage, updateLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getFinalNomineeRosterIds } from './BigBrotherNominationEngine'
import { getEligibleVoterRosterIds } from './BigBrotherVoteEngine'

async function getAnnouncerUserId(leagueId: string): Promise<string | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true },
  })
  return league?.userId ?? null
}

export function buildVoteProgressCopy(args: {
  cast: number
  eligible: number
  voteDeadlineAt: Date | null
}): { text: string; urgency: boolean } {
  const { cast, eligible, voteDeadlineAt } = args
  const m = Math.max(0, eligible)
  const n = Math.min(cast, m)
  const text = `🗳️ House vote in progress: ${n} of ${m} votes cast.`
  const remaining = m > 0 ? (m - n) / m : 0
  const deadlineMs = voteDeadlineAt?.getTime() ?? null
  const urgent =
    remaining < 0.25 && deadlineMs != null && deadlineMs - Date.now() < 2 * 60 * 60 * 1000 && deadlineMs > Date.now()
  return { text, urgency: urgent }
}

/**
 * Create or update the vote progress system line for a cycle in VOTING_OPEN.
 */
export async function syncBigBrotherVoteProgressChat(leagueId: string, cycleId: string): Promise<void> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: {
      phase: true,
      voteProgressMessageId: true,
      voteDeadlineAt: true,
    },
  })
  if (!cycle || cycle.phase !== 'VOTING_OPEN') return

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return

  const eligible = await getEligibleVoterRosterIds(leagueId, cycleId, config.hohVotesOnlyInTie)
  const m = eligible.length
  const finalNoms = await getFinalNomineeRosterIds(cycleId)
  const n = await prisma.bigBrotherEvictionVote.count({ where: { cycleId, voterRosterId: { in: eligible }, targetRosterId: { in: finalNoms } } })
  const { text, urgency } = buildVoteProgressCopy({
    cast: n,
    eligible: m,
    voteDeadlineAt: cycle.voteDeadlineAt,
  })

  const metadata: Record<string, unknown> = {
    bigBrother: true,
    bbVoteProgress: true,
    cycleId,
    urgency,
    voteDeadlineAt: cycle.voteDeadlineAt?.toISOString() ?? null,
  }

  const announcer = await getAnnouncerUserId(leagueId)
  if (!announcer) return

  if (cycle.voteProgressMessageId) {
    await updateLeagueChatMessage(cycle.voteProgressMessageId, { message: text, metadata })
    return
  }

  const created = await createLeagueChatMessage(leagueId, announcer, text, {
    idempotencyKey: `bb-vote-progress-${cycleId}`,
    type: 'system',
    metadata: { ...metadata, isSystem: true },
  })
  if (created?.id) {
    await prisma.bigBrotherCycle.update({
      where: { id: cycleId },
      data: { voteProgressMessageId: created.id },
    })
  }
}
