import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { createHash } from 'node:crypto'
import { resolveScheduledExileReturn } from './survivorExileLifecycle'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { postHostMessage } from './hostEngine'
import { logSurvivorAuditEntry } from './auditEntry'
import { computeExileBossScore, settleExileBossWeek } from './exileBoss'
import { readSurvivorLateSeasonSettings, type SurvivorLateSeasonSettings } from './lateSeasonSettings'

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
    const finalized = await tx.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_results_finalized' }, select: { id: true, data: true } })
    if (!finalized) return false
    const proof = finalized.data as { source?: string; userIds?: string[] } | null
    const leagueRow = await tx.league.findUnique({ where: { id: leagueId }, select: { survivorTokenCap: true, settings: true } })
    const late = readSurvivorLateSeasonSettings(leagueRow?.settings)
    if (island.bossWinsEnabled && late.exileBossMode !== 'chimmy_roster') {
      return settleScoreBossWeek(tx, { leagueId, week, islandId: island.id, islandWeek: island.currentWeek, wipeOnLoss: island.bossTokenResetOnWin,
        tokenCap: leagueRow?.survivorTokenCap ?? null, proof, late })
    }
    // Legacy Chimmy roster boss: roster scores alone do not establish a winner against the host. A
    // verified boss result is a separate prerequisite; without it this week stays retryable.
    const bossResult = island.bossWinsEnabled
      ? await tx.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_boss_result_finalized' }, select: { id: true, data: true } })
      : null
    const bossData = bossResult?.data && typeof bossResult.data === 'object' && !Array.isArray(bossResult.data)
      ? bossResult.data as { score?: unknown; source?: unknown } : null
    const bossScore = typeof bossData?.score === 'number' && Number.isFinite(bossData.score) &&
      typeof bossData.source === 'string' && bossData.source.trim() ? bossData.score : null
    if (island.bossWinsEnabled && bossScore == null) return false
    const league = leagueRow
    const entries = await tx.exileWeeklyEntry.findMany({ where: { exileId: island.id, week }, orderBy: [{ weeklyScore: 'desc' }, { userId: 'asc' }] })
    // Empty/missing results are retryable; do not consume the weekly idempotency marker.
    if (!entries.length) return false
    const eligible = []
    for (const entry of entries) {
      if (proof?.source === 'closed_exile_rosters_v1' && !proof.userIds?.includes(entry.userId)) continue
      const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: entry.userId } } })
      if (player?.playerState === 'exile') eligible.push({ entry, player })
    }
    if (!eligible.length) return false
    const best = eligible[0].entry.weeklyScore
    const bossWon = bossScore != null && bossScore >= best
    const tiedLeaders = eligible.filter(row => row.entry.weeklyScore === best)
    const winner = bossWon ? null : tiedLeaders.sort((a, b) => {
      const rank = (userId: string) => createHash('sha256').update(`${leagueId}:${week}:${userId}`).digest('hex')
      return rank(a.entry.userId).localeCompare(rank(b.entry.userId))
    })[0]
    let shielded = new Set<string>()
    if (bossWon && island.bossTokenResetOnWin) {
      const idols = await tx.survivorIdol.findMany({ where: { leagueId, powerType: 'token_shield', status: 'hidden' }, select: { currentOwnerUserId: true, rosterId: true } })
      shielded = new Set(idols.map(idol => idol.currentOwnerUserId).filter((id): id is string => Boolean(id)))
      for (const idol of idols.filter(row => !row.currentOwnerUserId && row.rosterId)) {
        const holder = await tx.roster.findFirst({ where: { id: idol.rosterId, leagueId }, select: { platformUserId: true } })
        if (holder?.platformUserId) shielded.add(holder.platformUserId)
      }
      await tx.survivorPlayer.updateMany({ where: { leagueId, playerState: 'exile', userId: { notIn: [...shielded] } }, data: { tokenBalance: 0 } })
    }
    for (const { entry, player } of eligible) {
      const award = winner?.entry.id === entry.id &&
        (league?.survivorTokenCap == null || player.tokenBalance < league.survivorTokenCap) ? 1 : 0
      if (award) await tx.survivorPlayer.update({ where: { id: player.id }, data: { tokenBalance: { increment: 1 }, totalTokensEarned: { increment: 1 } } })
      await tx.exileWeeklyEntry.update({ where: { id: entry.id }, data: {
        bossScore, bossWon, tokenEarned: award,
        tokenWiped: bossWon && island.bossTokenResetOnWin && player.tokenBalance > 0 && !shielded.has(entry.userId),
      } })
    }
    await tx.exileIsland.update({ where: { id: island.id }, data: { currentWeek: Math.max(island.currentWeek, week) } })
    const balances = await tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile' }, select: { userId: true, tokenBalance: true, totalTokensEarned: true, eliminatedWeek: true } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'exile', action: 'exile_week_scored', data: {
      entryCount: entries.length, bossScore, bossWon, winnerUserId: winner?.entry.userId ?? null,
      tieBreak: tiedLeaders.length > 1 && winner ? 'seeded_random' : null, balances,
    }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
    return true
  }, { timeout: 30_000, maxWait: 10_000 })
}

/** Token-shield holders (by user id), resolving roster-held idols to their owner. */
async function shieldedExileUserIds(tx: Prisma.TransactionClient, leagueId: string): Promise<Set<string>> {
  const idols = await tx.survivorIdol.findMany({ where: { leagueId, powerType: 'token_shield', status: 'hidden' }, select: { currentOwnerUserId: true, rosterId: true } })
  const shielded = new Set(idols.map(idol => idol.currentOwnerUserId).filter((id): id is string => Boolean(id)))
  for (const idol of idols.filter(row => !row.currentOwnerUserId && row.rosterId)) {
    const holder = await tx.roster.findFirst({ where: { id: idol.rosterId, leagueId }, select: { platformUserId: true } })
    if (holder?.platformUserId) shielded.add(holder.platformUserId)
  }
  return shielded
}

/** Final main-island scores for the week that a median/topN boss is computed from. */
export async function readFinalActiveWeekScores(db: Pick<Prisma.TransactionClient, 'survivorWeeklyScore'>, leagueId: string, week: number): Promise<number[]> {
  const rows = await db.survivorWeeklyScore.findMany({ where: { leagueId, week, isFinalized: true }, select: { finalScore: true } })
  return rows.map(row => row.finalScore)
}

/**
 * Score-based Exile boss (median / fixed / topN). Everyone below the boss loses their tokens
 * (unless shielded); the top score strictly above it wins the week. Settlement rules live in
 * lib/survivor/exileBoss.ts so the Exile board renders exactly what the ledger records.
 */
async function settleScoreBossWeek(tx: Prisma.TransactionClient, ctx: {
  leagueId: string; week: number; islandId: string; islandWeek: number; wipeOnLoss: boolean; tokenCap: number | null
  proof: { source?: string; userIds?: string[] } | null; late: SurvivorLateSeasonSettings
}): Promise<boolean> {
  const { leagueId, week, late } = ctx
  const mode = late.exileBossMode === 'chimmy_roster' ? 'median' : late.exileBossMode
  const activeScores = mode === 'fixed' ? [] : await readFinalActiveWeekScores(tx, leagueId, week)
  const boss = computeExileBossScore({ mode, fixedScore: late.exileBossFixedScore, topN: late.exileBossTopN }, activeScores)
  // No final main-island scores yet: the boss is unknown, so the week stays retryable.
  if (boss == null) return false
  const entries = await tx.exileWeeklyEntry.findMany({ where: { exileId: ctx.islandId, week }, orderBy: [{ weeklyScore: 'desc' }, { userId: 'asc' }] })
  if (!entries.length) return false
  const eligible = []
  for (const entry of entries) {
    if (ctx.proof?.source === 'closed_exile_rosters_v1' && !ctx.proof.userIds?.includes(entry.userId)) continue
    const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: entry.userId } } })
    if (player?.playerState === 'exile') eligible.push({ entry, player })
  }
  if (!eligible.length) return false
  const shielded = ctx.wipeOnLoss ? await shieldedExileUserIds(tx, leagueId) : new Set<string>()
  const settled = settleExileBossWeek({
    boss,
    rows: eligible.map(({ entry, player }) => ({ userId: entry.userId, displayName: entry.userId, score: entry.weeklyScore, tokens: player.tokenBalance, shielded: shielded.has(entry.userId) })),
    tokenCap: ctx.tokenCap,
    wipeOnLoss: ctx.wipeOnLoss,
    tieKey: userId => createHash('sha256').update(`${leagueId}:${week}:${userId}`).digest('hex'),
  })
  for (const { entry, player } of eligible) {
    const row = settled.rows.find(r => r.userId === entry.userId)!
    if (row.wipedTokens > 0) await tx.survivorPlayer.update({ where: { id: player.id }, data: { tokenBalance: row.tokensAfter } })
    if (row.earnedToken) await tx.survivorPlayer.update({ where: { id: player.id }, data: { tokenBalance: { increment: 1 }, totalTokensEarned: { increment: 1 } } })
    await tx.exileWeeklyEntry.update({ where: { id: entry.id }, data: {
      bossScore: boss, bossWon: row.finalStatus === 'wiped', tokenEarned: row.earnedToken ? 1 : 0, tokenWiped: row.wipedTokens > 0,
    } })
  }
  await tx.exileIsland.update({ where: { id: ctx.islandId }, data: { currentWeek: Math.max(ctx.islandWeek, week) } })
  const balances = await tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile' }, select: { userId: true, tokenBalance: true, totalTokensEarned: true, eliminatedWeek: true } })
  await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'exile', action: 'exile_week_scored', data: {
    entryCount: entries.length, bossScore: boss, bossMode: mode, bossWon: settled.rows.some(r => r.finalStatus === 'wiped'),
    winnerUserId: settled.winnerUserId, wiped: Object.fromEntries(settled.rows.filter(r => r.wipedTokens > 0).map(r => [r.userId, r.wipedTokens])), balances,
  }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
  return true
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
