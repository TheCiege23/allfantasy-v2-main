import 'server-only'

import { prisma } from '@/lib/prisma'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import {
  activeConductStrikes,
  conductStrikeOutcome,
  CONDUCT_STRIKE_ISSUED,
  CONDUCT_STRIKE_REVOKED,
  validateStrikeReason,
  type ConductStrike,
} from './survivorConductStrikes'
import { governanceCopy } from './survivorGovernanceCopy'
import { removeSurvivorPlayer } from './survivorRemovePlayer'

/**
 * Conduct strikes: the commissioner issues a warning with a reason; the castaway is told privately
 * by Chimmy and sees their strikes on their island screen; at the league's limit the castaway is
 * removed through the same path as the Hub's "remove a manager" (when the commissioner switched
 * automatic removal on), otherwise the commissioner is told the limit is reached.
 */

const CONDUCT_ROW_SELECT = { id: true, action: true, targetUserId: true, week: true, createdAt: true, data: true } as const

export async function listSurvivorConductStrikes(leagueId: string, userId?: string): Promise<ConductStrike[]> {
  const rows = await prisma.survivorAuditEntry.findMany({
    where: { leagueId, category: 'conduct', action: { in: [CONDUCT_STRIKE_ISSUED, CONDUCT_STRIKE_REVOKED] } },
    orderBy: { createdAt: 'asc' },
    select: CONDUCT_ROW_SELECT,
  })
  return activeConductStrikes(rows, userId)
}

type StrikeResult =
  | { ok: true; strikeId: string; activeStrikes: number; limit: number; limitReached: boolean; removed: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string }

async function sendPrivateChimmyNote(leagueId: string, hostUserId: string, targetUserId: string, message: string, key: string): Promise<void> {
  await prisma.leagueChatMessage.create({
    data: {
      id: key, leagueId, userId: hostUserId, message, type: 'system', isPrivate: true,
      visibleToUserId: targetUserId, messageSubtype: 'chimmy_private',
      metadata: { chimmyPrivateReply: true, survivorConductStrike: true },
    },
  }).catch((error: unknown) => {
    console.warn('[survivor-conduct] private note failed', { leagueId, error: error instanceof Error ? error.message : String(error) })
  })
}

export async function issueSurvivorConductStrike(
  leagueId: string,
  input: { targetUserId: string; reason: string; actorUserId: string },
): Promise<StrikeResult> {
  const reasonError = validateStrikeReason(input.reason)
  if (reasonError) return { ok: false, status: 400, error: reasonError }
  const [league, player, game] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true, language: true } }),
    prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: input.targetUserId } }, select: { playerState: true, displayName: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }),
  ])
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (!player) return { ok: false, status: 404, error: 'That castaway is not in this Survivor league.' }
  if (player.playerState === 'eliminated') return { ok: false, status: 409, error: `${player.displayName} is already out of the season.` }
  const settings = readSurvivorGovernanceSettings(league.settings)
  const reason = input.reason.trim()
  const entry = await prisma.survivorAuditEntry.create({
    data: {
      leagueId, week: game?.currentWeek ?? null, category: 'conduct', action: CONDUCT_STRIKE_ISSUED,
      actorUserId: input.actorUserId, targetUserId: input.targetUserId,
      data: { reason }, isVisibleToCommissioner: true, isVisibleToPublic: false,
    },
    select: { id: true },
  })
  const active = (await listSurvivorConductStrikes(leagueId, input.targetUserId)).length
  const outcome = conductStrikeOutcome(active, settings)
  const m = governanceCopy(league.language)
  const note = [m.strikeIssued(active, settings.strikeLimit, reason), outcome.removeNow ? m.strikeRemoved : outcome.limitReached ? '' : m.strikeLimitWarning(settings.strikeLimit)].filter(Boolean).join(' ')
  await sendPrivateChimmyNote(leagueId, league.userId, input.targetUserId, note, `survivor-strike:${entry.id}:notice`)
  if (outcome.removeNow) {
    await removeSurvivorPlayer(leagueId, { targetUserId: input.targetUserId, commissionerId: input.actorUserId, reason: `Conduct strike limit (${settings.strikeLimit}): ${reason}`, actionType: 'remove_player_conduct' })
  }
  return { ok: true, strikeId: entry.id, activeStrikes: active, limit: settings.strikeLimit, limitReached: outcome.limitReached, removed: outcome.removeNow }
}

export async function revokeSurvivorConductStrike(
  leagueId: string,
  input: { targetUserId: string; reason: string; actorUserId: string; strikeId: string | null },
): Promise<{ ok: true; activeStrikes: number } | { ok: false; status: 404; error: string }> {
  const strikes = await listSurvivorConductStrikes(leagueId, input.targetUserId)
  // Without an id, the most recent strike is withdrawn.
  const strike = input.strikeId ? strikes.find((s) => s.id === input.strikeId) : strikes[strikes.length - 1]
  if (!strike) return { ok: false, status: 404, error: 'That castaway has no standing strike to withdraw.' }
  const [league, game] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, language: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }),
  ])
  await prisma.survivorAuditEntry.create({
    data: {
      leagueId, week: game?.currentWeek ?? null, category: 'conduct', action: CONDUCT_STRIKE_REVOKED,
      actorUserId: input.actorUserId, targetUserId: input.targetUserId,
      data: { strikeId: strike.id, reason: input.reason.trim() || null }, isVisibleToCommissioner: true, isVisibleToPublic: false,
    },
  })
  const remaining = strikes.length - 1
  if (league) await sendPrivateChimmyNote(leagueId, league.userId, input.targetUserId, governanceCopy(league.language).strikeRevoked(remaining), `survivor-strike:${strike.id}:revoked`)
  return { ok: true, activeStrikes: remaining }
}
