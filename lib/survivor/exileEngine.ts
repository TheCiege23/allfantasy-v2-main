import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resolveScheduledExileReturn } from './survivorExileLifecycle'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { postHostMessage } from './hostEngine'
import { logSurvivorAuditEntry } from './auditEntry'

/** Default conversion: 1 token → $5 FAAB on main league roster (Int field). */
const TOKEN_TO_FAAB = 5
/** Optional points conversion applied post-return (logged; scoring hook may consume). */
const TOKEN_TO_POINTS = 3

export async function sendPlayerToExile(leagueId: string, userId: string, week?: number): Promise<void> {
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId },
    data: {
      playerState: 'exile',
      canAccessExileChat: true,
      canAccessTribeChat: false,
      canAccessMergeChat: false,
      exileWeeksServed: { increment: 1 },
    },
  })
  await logSurvivorAuditEntry({
    leagueId,
    week: week ?? null,
    category: 'exile',
    action: 'PLAYER_EXILED',
    targetUserId: userId,
    data: { userId, week: week ?? null },
    isVisibleToPublic: false,
  })
  await postHostMessage(leagueId, 'exile_update', { userId }, 'exile_chat').catch(() => {})
}

async function userIdsWithTokenShield(leagueId: string): Promise<Set<string>> {
  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, powerType: 'token_shield', status: 'hidden' },
    select: { rosterId: true, currentOwnerUserId: true },
  })
  const out = new Set<string>()
  for (const i of idols) {
    if (i.currentOwnerUserId) {
      out.add(i.currentOwnerUserId)
      continue
    }
    const r = await prisma.roster.findFirst({
      where: { id: i.rosterId, leagueId },
      select: { platformUserId: true },
    })
    if (r?.platformUserId) out.add(r.platformUserId)
  }
  return out
}

/**
 * Apply a token delta to a SurvivorPlayer in exile (or main state); enforces floor 0 and optional league cap.
 */
export async function applyExileTokenDelta(params: {
  leagueId: string
  userId: string
  week: number
  delta: number
  source: string
  reason?: string
}): Promise<{ newBalance: number; cappedWaste: number }> {
  const { leagueId, userId, week, delta, source, reason } = params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorTokenCap: true },
  })
  const cap = league?.survivorTokenCap

  const player = await prisma.survivorPlayer.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { id: true, tokenBalance: true },
  })
  if (!player) {
    return { newBalance: 0, cappedWaste: delta > 0 ? delta : 0 }
  }

  let next = Math.max(0, player.tokenBalance + delta)
  let cappedWaste = 0
  if (cap != null && cap >= 0 && next > cap) {
    cappedWaste = next - cap
    next = cap
  }

  const gained = next - player.tokenBalance
  const data: Prisma.SurvivorPlayerUpdateInput = { tokenBalance: next }
  if (gained > 0) {
    data.totalTokensEarned = { increment: gained }
  }

  await prisma.survivorPlayer.update({
    where: { id: player.id },
    data,
  })

  const action = delta >= 0 ? 'TOKEN_EARNED' : 'TOKEN_LOST'
  await logSurvivorAuditEntry({
    leagueId,
    week,
    category: 'token',
    action,
    targetUserId: userId,
    data: {
      userId,
      amount: Math.abs(delta),
      signedDelta: delta,
      source,
      reason: reason ?? null,
      week,
      newBalance: next,
      cappedWaste: cappedWaste > 0 ? cappedWaste : undefined,
    },
    isVisibleToPublic: false,
  })

  return { newBalance: next, cappedWaste }
}

export async function resetExileTokensOnBossWin(leagueId: string, week: number): Promise<void> {
  const island = await prisma.exileIsland.findUnique({ where: { leagueId } })
  if (!island?.bossTokenResetOnWin) return

  const shielded = await userIdsWithTokenShield(leagueId)
  const players = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'exile' },
    select: { userId: true, tokenBalance: true },
  })

  const affected: string[] = []
  for (const p of players) {
    if (shielded.has(p.userId)) continue
    if (p.tokenBalance <= 0) continue
    await prisma.survivorPlayer.updateMany({
      where: { leagueId, userId: p.userId },
      data: { tokenBalance: 0 },
    })
    affected.push(p.userId)
  }

  await logSurvivorAuditEntry({
    leagueId,
    week,
    category: 'token',
    action: 'TOKEN_RESET',
    data: { bossWon: true, affectedUserIds: affected, week },
    isVisibleToPublic: false,
  })
}

export async function scoreExileWeek(leagueId: string, week: number): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const island = await tx.exileIsland.findUnique({ where: { leagueId } })
    if (!island?.isActive) return false
    if (await tx.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_week_scored' }, select: { id: true } })) return true
    // Zero is a valid final score, but the table's default zero is not evidence of a result.
    if (!await tx.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_results_finalized' }, select: { id: true } })) return false
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { survivorTokenCap: true } })
    const entries = await tx.exileWeeklyEntry.findMany({ where: { exileId: island.id, week }, orderBy: [{ weeklyScore: 'desc' }, { userId: 'asc' }] })
    // Empty/missing results are retryable; do not consume the weekly idempotency marker.
    if (!entries.length) return false
    const eligible = []
    for (const entry of entries) {
      const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: entry.userId } } })
      if (player?.playerState === 'exile') eligible.push({ entry, player })
    }
    if (!eligible.length) return false
    const best = eligible[0].entry.weeklyScore
    for (const { entry, player } of eligible.filter(row => row.entry.weeklyScore === best)) {
      const award = league?.survivorTokenCap != null && player.tokenBalance >= league.survivorTokenCap ? 0 : 1
      await tx.survivorPlayer.update({ where: { id: player.id }, data: { tokenBalance: { increment: award }, totalTokensEarned: { increment: award } } })
      await tx.exileWeeklyEntry.update({ where: { id: entry.id }, data: { tokenEarned: award } })
    }
    await tx.exileIsland.update({ where: { id: island.id }, data: { currentWeek: week } })
    const balances = await tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile' }, select: { userId: true, tokenBalance: true, totalTokensEarned: true, eliminatedWeek: true } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'exile', action: 'exile_week_scored', data: { entryCount: entries.length, balances }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
    return true
  }, { timeout: 30_000, maxWait: 10_000 })
}

export type ExileReturnConversionMode = 'faab' | 'points' | 'expire'

/**
 * Return top token-holder from exile when trigger matches. Optionally converts tokens before reset.
 */
export async function processReturnFromExile(
  leagueId: string,
  opts?: { conversionMode?: ExileReturnConversionMode; week?: number },
): Promise<string | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorExileReturnTrigger: true, platform: true },
  })
  if (league && isNativePlatform(league.platform)) return opts?.week ? resolveScheduledExileReturn(leagueId, opts.week) : null
  if (league?.survivorExileReturnTrigger !== 'token_leader') return null

  const top = await prisma.survivorPlayer.findFirst({
    where: { leagueId, playerState: 'exile' },
    orderBy: { tokenBalance: 'desc' },
  })
  if (!top) return null

  const week = opts?.week ?? 0
  const mode = opts?.conversionMode ?? 'faab'
  const tokens = top.tokenBalance

  if (tokens > 0 && mode === 'faab') {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, platformUserId: top.userId },
      select: { id: true, faabRemaining: true },
    })
    if (roster) {
      await prisma.roster.update({
        where: { id: roster.id },
        data: { faabRemaining: (roster.faabRemaining ?? 0) + tokens * TOKEN_TO_FAAB },
      })
    }
    await logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'exile',
      action: 'EXILE_RETURN',
      targetUserId: top.userId,
      data: {
        userId: top.userId,
        tokenBalance: tokens,
        converted: true,
        conversion: 'faab',
        faabPerToken: TOKEN_TO_FAAB,
      },
      isVisibleToPublic: false,
    })
  } else if (tokens > 0 && mode === 'points') {
    await logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'exile',
      action: 'EXILE_RETURN',
      targetUserId: top.userId,
      data: {
        userId: top.userId,
        tokenBalance: tokens,
        converted: true,
        conversion: 'points',
        pointsPerToken: TOKEN_TO_POINTS,
        note: 'Apply points in weekly scoring pipeline for week after return.',
      },
      isVisibleToPublic: false,
    })
  } else {
    await logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'exile',
      action: 'EXILE_RETURN',
      targetUserId: top.userId,
      data: { userId: top.userId, tokenBalance: tokens, converted: false },
      isVisibleToPublic: false,
    })
  }

  await prisma.survivorPlayer.update({
    where: { id: top.id },
    data: {
      playerState: 'active',
      canAccessExileChat: false,
      canAccessMergeChat: true,
      exileReturnEligible: false,
      tokenBalance: 0,
    },
  })

  await postHostMessage(leagueId, 'twist_announcement', { returnedUserId: top.userId }, 'league_chat').catch(
    () => {},
  )
  return top.userId
}
