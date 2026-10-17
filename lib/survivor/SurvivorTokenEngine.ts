import { isNativePlatform } from '@/lib/dashboard/platform-label'
/**
 * Survivor Exile tokens: award, reset when Boss wins, check return (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import type { SurvivorExileTokenState } from './types'

/**
 * Award one token to top-scoring Exile roster for the week. Call after weekly scoring.
 */
export async function awardTokenToTopExile(
  exileLeagueId: string,
  week: number,
  topRosterId: string
): Promise<void> {
  const main = await prisma.survivorExileLeague.findFirst({
    where: { exileLeagueId },
    select: { mainLeagueId: true, configId: true },
  })
  if (!main) return

  await prisma.survivorExileToken.upsert({
    where: { exileLeagueId_rosterId: { exileLeagueId, rosterId: topRosterId } },
    create: { exileLeagueId, rosterId: topRosterId, tokens: 1, lastAwardedWeek: week },
    update: { tokens: { increment: 1 }, lastAwardedWeek: week },
  })
  await appendSurvivorAudit(main.mainLeagueId, main.configId, 'token_awarded', {
    exileLeagueId,
    rosterId: topRosterId,
    week,
  })
}

/**
 * Reset all tokens to 0 when commissioner/Boss has top score (call from weekly processing).
 */
export async function resetAllTokensWhenBossWins(exileLeagueId: string, mainLeagueId: string): Promise<void> {
  const config = await getSurvivorConfig(mainLeagueId)
  if (!config) return

  const league = await prisma.league.findUnique({
    where: { id: mainLeagueId },
    select: { userId: true },
  })
  if (!league) return

  const exileRosters = await prisma.roster.findMany({
    where: { leagueId: exileLeagueId },
    select: { id: true },
  })
  for (const r of exileRosters) {
    await prisma.survivorExileToken.updateMany({
      where: { exileLeagueId, rosterId: r.id },
      data: { tokens: 0 },
    })
  }
  await appendSurvivorAudit(mainLeagueId, config.configId, 'token_reset', {
    reason: 'boss_wins',
    exileLeagueId,
  })
}

/**
 * Get token state for a roster in exile league.
 */
export async function getTokenState(exileLeagueId: string, rosterId: string): Promise<SurvivorExileTokenState | null> {
  const native = await readNativeExileTokens(exileLeagueId)
  if (native) return native.find(row => row.rosterId === rosterId) ?? null
  const row = await prisma.survivorExileToken.findUnique({
    where: { exileLeagueId_rosterId: { exileLeagueId, rosterId } },
  })
  if (!row) return null
  return {
    rosterId: row.rosterId,
    tokens: row.tokens,
    lastAwardedWeek: row.lastAwardedWeek,
  }
}

/**
 * Get all token states for exile league.
 */
export async function getAllTokenStates(exileLeagueId: string): Promise<SurvivorExileTokenState[]> {
  const native = await readNativeExileTokens(exileLeagueId)
  if (native) return native
  const rows = await prisma.survivorExileToken.findMany({
    where: { exileLeagueId },
  })
  return rows.map((r) => ({
    rosterId: r.rosterId,
    tokens: r.tokens,
    lastAwardedWeek: r.lastAwardedWeek,
  }))
}

/** Native Exile uses the main cast's single token balance. Legacy linked leagues retain their ledger. */
async function readNativeExileTokens(exileLeagueId: string): Promise<SurvivorExileTokenState[] | null> {
  const link = await prisma.survivorExileLeague.findFirst({ where: { exileLeagueId }, select: { mainLeagueId: true } })
  if (!link) return null
  const league = await prisma.league.findUnique({ where: { id: link.mainLeagueId }, select: { platform: true } })
  if (!league || !isNativePlatform(league.platform)) return null
  const rosters = await prisma.roster.findMany({ where: { leagueId: exileLeagueId }, select: { id: true, platformUserId: true } })
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId: link.mainLeagueId }, select: { userId: true, tokenBalance: true } })
  return rosters.map(roster => ({ rosterId: roster.id, tokens: players.find(player => player.userId === roster.platformUserId)?.tokenBalance ?? 0, lastAwardedWeek: null }))
}
