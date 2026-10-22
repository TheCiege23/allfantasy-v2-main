import 'server-only'

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext } from './survivorCouncilService'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { SURVIVOR_SHOT_IN_THE_DARK_ODDS, type SurvivorShotInTheDarkOdds } from './survivorSettings'

const ACTION = 'shot_in_the_dark_played'

/** The league's odds (1 in 4, 5 or 6; owner's default 6). Tolerates a context without settings. */
export function shotInTheDarkOdds(settings: { shotInTheDarkOdds?: number | null } | null | undefined): SurvivorShotInTheDarkOdds {
  const value = settings?.shotInTheDarkOdds
  return (SURVIVOR_SHOT_IN_THE_DARK_ODDS as readonly number[]).includes(value as number) ? value as SurvivorShotInTheDarkOdds : 6
}

function recordId(leagueId: string, userId: string): string {
  return `survivor-shot:${leagueId}:${userId}`
}

function shotResult(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as Record<string, unknown>).success === true)
}

/** The owner alone receives the result before the public Torch Ceremony. */
export async function getShotInTheDarkStatus(leagueId: string, userId: string) {
  const [ctx, used, game] = await Promise.all([
    loadCouncilContext(leagueId),
    prisma.survivorAuditEntry.findUnique({ where: { id: recordId(leagueId, userId) }, select: { data: true, relatedEntityId: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } }),
  ])
  const open = ctx?.council.status === 'voting_open' && !ctx.council.isRevealed &&
    ctx.council.phase !== 'revote' && new Date() <= ctx.council.voteDeadlineAt
  const rosterId = ctx?.userToRoster[userId]
  const voted = rosterId && ctx ? await prisma.survivorVote.findUnique({
    where: { councilId_voterRosterId: { councilId: ctx.council.id, voterRosterId: rosterId } }, select: { id: true },
  }) : null
  return {
    available: Boolean(open && game?.pausedSnapshot == null && !used && !voted && ctx?.eligibility.voterUserIds.includes(userId)),
    used: Boolean(used),
    success: used ? shotResult(used.data) : null,
    councilId: used?.relatedEntityId ?? ctx?.council.id ?? null,
    odds: shotInTheDarkOdds(ctx?.settings),
  }
}

/**
 * One use per manager per league; the draw and forfeited vote are committed together. The draw is
 * 1 in the league's configured odds; `roll(odds)` returns 1..odds and 1 is safe.
 */
export async function playShotInTheDark(leagueId: string, userId: string, roll: (odds: number) => number = (odds) => randomInt(odds) + 1) {
  return withSurvivorSetupTransaction(leagueId, async tx => {
    const ctx = await loadCouncilContext(leagueId, undefined, tx)
    if (!ctx || ctx.council.status !== 'voting_open' || ctx.council.isRevealed ||
      ctx.council.phase === 'revote' || new Date() > ctx.council.voteDeadlineAt) {
      return { ok: false as const, status: 409 as const, error: 'Shot in the Dark is available only during your original council vote window.' }
    }
    if (!ctx.eligibility.voterUserIds.includes(userId)) {
      return { ok: false as const, status: 403 as const, error: 'You are not eligible at this council.' }
    }
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false as const, status: 409 as const, error: 'The league is paused.' }
    const rosterId = ctx.userToRoster[userId]
    if (!rosterId) return { ok: false as const, status: 409 as const, error: 'Your roster could not be verified.' }
    if (await tx.survivorAuditEntry.findUnique({ where: { id: recordId(leagueId, userId) }, select: { id: true } })) {
      return { ok: false as const, status: 409 as const, error: 'You have already used your one Shot in the Dark.' }
    }
    if (await tx.survivorVote.findUnique({
      where: { councilId_voterRosterId: { councilId: ctx.council.id, voterRosterId: rosterId } }, select: { id: true },
    })) {
      return { ok: false as const, status: 409 as const, error: 'You have already voted at this council. The draw must replace your vote.' }
    }
    if (ctx.council.idolsPlayed.some(play => play.playerUserId === userId &&
      (play.powerType === 'extra_vote' || play.powerType === 'vote_steal') && play.extraTargetUserId)) {
      return { ok: false as const, status: 409 as const, error: 'You have already cast an additional idol vote at this council.' }
    }
    const odds = shotInTheDarkOdds(ctx.settings)
    const draw = roll(odds)
    if (!Number.isInteger(draw) || draw < 1 || draw > odds) throw new Error('Invalid Shot in the Dark draw')
    const success = draw === 1
    await tx.survivorAuditEntry.create({ data: {
      id: recordId(leagueId, userId), leagueId, week: ctx.council.week,
      category: 'tribal', action: ACTION, actorUserId: userId, targetUserId: userId,
      relatedEntityId: ctx.council.id, relatedEntityType: 'council',
      data: { draw, odds, success, forfeitedVote: true },
      isVisibleToCommissioner: false, isVisibleToPublic: false,
    } })
    return { ok: true as const, success, councilId: ctx.council.id,
      message: success ? 'Your draw is safe. You have immunity at this council and cannot vote.' : 'Your draw is not safe. You cannot vote at this council.' }
  })
}

export async function getCouncilShots(leagueId: string, councilId: string) {
  const rows = await prisma.survivorAuditEntry.findMany({
    where: { leagueId, relatedEntityId: councilId, action: ACTION },
    select: { actorUserId: true, data: true }, orderBy: { createdAt: 'asc' },
  })
  return rows.filter((row): row is typeof row & { actorUserId: string } => Boolean(row.actorUserId))
    .map(row => ({ userId: row.actorUserId, success: shotResult(row.data) }))
}
