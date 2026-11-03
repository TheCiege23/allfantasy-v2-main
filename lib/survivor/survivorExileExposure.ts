import 'server-only'

/**
 * "Removed if exposed" — the original league's rule, as an OPTIONAL commissioner action (never
 * automatic). While "hide who is on Exile" is on and the commissioner has chosen a penalty
 * (`exileExposureRule` in League.settings.survivorSideGames), the commissioner can mark a manager as
 * having exposed an exile:
 *  - `remove`: the manager is removed through the Hub's own removal (survivorRemovePlayer.ts);
 *  - `strike`: a conduct strike through the strikes service (survivorConductService.ts), which keeps
 *    its own limit and auto-removal rules.
 * Two steps: without `confirm` nothing changes and the preview is returned; with it the penalty is
 * applied, audited (`exile_exposure_penalty`, commissioner-visible, never public) and the manager is
 * told privately by Chimmy in the league's language. Rules: survivorExileSecrecy.exileExposureCheck.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { exileExposureCheck } from './survivorExileSecrecy'
import { readSurvivorSideGameSettings } from './survivorSideGameSettings'
import { sideGameCopy } from './survivorSideGameCopy'

export const EXILE_EXPOSURE_ACTION = 'exile_exposure_penalty'

export type ExileExposureResult =
  | { ok: true; preview: true; penalty: 'remove' | 'strike'; displayName: string; message: string }
  | { ok: true; preview: false; penalty: 'remove' | 'strike'; displayName: string; removed: boolean; strikes?: number }
  | { ok: false; status: 400 | 404 | 409; error: string }

export async function applyExileExposurePenalty(
  leagueId: string,
  input: { targetUserId: string; actorUserId: string; confirm: boolean; note?: string | null },
): Promise<ExileExposureResult> {
  const [league, target, game] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true, language: true } }),
    prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: input.targetUserId } }, select: { playerState: true, displayName: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }),
  ])
  const m = sideGameCopy(league?.language)
  if (!league) return { ok: false, status: 404, error: m.notSurvivor }
  const s = readSurvivorSideGameSettings(league.settings)
  const check = exileExposureCheck({ hidden: s.hideExileMembership, rule: s.exileExposureRule, target, targetIsActor: input.targetUserId === input.actorUserId, confirm: input.confirm })
  if (!check.ok) {
    const error = check.reason === 'rule_off' ? m.exposureOff
      : check.reason === 'not_hidden' ? m.exposureNotHidden
        : check.reason === 'not_castaway' ? m.exposureNotCastaway
          : check.reason === 'self' ? m.exposureSelf
            : m.exposureAlreadyOut
    return { ok: false, status: check.status, error }
  }
  const displayName = target!.displayName
  const penaltyText = check.penalty === 'remove' ? m.exposurePenaltyRemove : m.exposurePenaltyStrike
  if (!check.confirmed) return { ok: true, preview: true, penalty: check.penalty, displayName, message: m.exposurePreview(displayName, penaltyText) }

  const note = (input.note ?? '').trim().slice(0, 200)
  const reason = note ? `${m.exposureReason}: ${note}` : m.exposureReason
  const entry = await prisma.survivorAuditEntry.create({
    data: {
      leagueId, week: game?.currentWeek ?? null, category: 'conduct', action: EXILE_EXPOSURE_ACTION,
      actorUserId: input.actorUserId, targetUserId: input.targetUserId,
      data: { penalty: check.penalty, reason, previousState: target!.playerState } as Prisma.InputJsonValue,
      isVisibleToCommissioner: true, isVisibleToPublic: false,
    },
    select: { id: true },
  })

  let removed = false
  let strikes: number | undefined
  if (check.penalty === 'remove') {
    const { removeSurvivorPlayer } = await import('./survivorRemovePlayer')
    await removeSurvivorPlayer(leagueId, { targetUserId: input.targetUserId, commissionerId: input.actorUserId, reason, actionType: 'remove_player_exposed_exile' })
    removed = true
  } else {
    const { issueSurvivorConductStrike } = await import('./survivorConductService')
    const strike = await issueSurvivorConductStrike(leagueId, { targetUserId: input.targetUserId, reason, actorUserId: input.actorUserId })
    if (!strike.ok) return { ok: false, status: strike.status as 400 | 404 | 409, error: strike.error }
    strikes = strike.activeStrikes
    removed = strike.removed
  }

  if (league.userId) {
    await prisma.leagueChatMessage.create({
      data: {
        id: `survivor-exile-exposed:${entry.id}`, leagueId, userId: league.userId, type: 'system', isPrivate: true,
        message: check.penalty === 'remove' ? m.exposureDmRemoved : m.exposureDmStrike,
        visibleToUserId: input.targetUserId, messageSubtype: 'chimmy_private',
        metadata: { chimmyPrivateReply: true, survivorExileExposure: true },
      },
    }).catch((error: unknown) => console.warn('[survivor-exile-exposure] private note failed', { leagueId, error: error instanceof Error ? error.message : String(error) }))
  }
  return { ok: true, preview: false, penalty: check.penalty, displayName, removed, strikes }
}
