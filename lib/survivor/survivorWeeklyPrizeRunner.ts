/**
 * The season runner's reward steps (survivorPlannedSeasonRunner.ts). Both are idempotent and
 * best-effort: every call is safe on every 5-minute tick, and a failure never holds up the island.
 *
 *  - `runSurvivorRewardOpenStep` (top of every week tick): deferred rewards whose week has come, and
 *    Chimmy's choices ("points on a tribemate", steal targets) for the seats it runs.
 *  - `applyWeeklyTribePrizes` (once the week's scores are final): the commissioner's weekly tribe
 *    prizes — FAAB per player for the top-scoring tribe and the top-scorer reward. Before the merge
 *    only; the winning tribe is ranked with the same key-position tie-break the council uses.
 */

import { prisma } from '@/lib/prisma'
import { applyDueDeferredSurvivorRewards, applySurvivorReward } from './survivorRewardEngine'
import { loadWeekTieBreak, rankTribesByTotal, tribeTotals } from './survivorCouncilImmunity'
import { planWeeklyTribePrizes, readSurvivorWeeklyPrizes, weeklyPrizesActive } from './survivorWeeklyPrizes'

const PRE_MERGE_PHASES = new Set(['pre_merge', 'post_swap'])

export type WeeklyPrizeOutcome = { paid: string[]; skipped?: 'off' | 'merged' | 'no_tribes' | 'no_scores' }

export async function applyWeeklyTribePrizes(leagueId: string, week: number): Promise<WeeklyPrizeOutcome> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prizes = readSurvivorWeeklyPrizes(league?.settings)
  if (!weeklyPrizesActive(prizes)) return { paid: [], skipped: 'off' }
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } })
  if (!game || game.mergeTriggeredAt || !PRE_MERGE_PHASES.has(game.phase)) return { paid: [], skipped: 'merged' }

  const tribeIds = (await prisma.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true } })).map((t) => t.id)
  if (tribeIds.length < 2) return { paid: [], skipped: 'no_tribes' }
  const castaways = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active', tribeId: { in: tribeIds } },
    select: { userId: true, tribeId: true, redraftRosterId: true },
  })
  const scores = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week, isFinalized: true, tribeId: { not: null }, userId: { in: castaways.map((c) => c.userId) } },
    select: { userId: true, tribeId: true, finalScore: true, countedTowardTribeTotal: true },
  })
  const totals = tribeTotals(scores)
  if (!totals.size) return { paid: [], skipped: 'no_scores' }
  const tieBreak = await loadWeekTieBreak(leagueId, week, totals, tribeIds, { tieBreakPosition: prizes.tribeTieBreakPosition })
  const winningTribeId = rankTribesByTotal(totals, tieBreak).find((id) => tribeIds.includes(id))
  if (!winningTribeId) return { paid: [], skipped: 'no_scores' }

  const scoreByUser = new Map(scores.filter((s) => s.countedTowardTribeTotal !== false).map((s) => [s.userId, s.finalScore]))
  const members = castaways
    .filter((c) => c.tribeId === winningTribeId && c.redraftRosterId)
    // A sat-out manager still shares the tribe's FAAB, but cannot be its top scorer.
    .map((c) => ({ rosterId: c.redraftRosterId!, userId: c.userId, finalScore: scoreByUser.get(c.userId) ?? Number.NEGATIVE_INFINITY }))
  const paid: string[] = []
  for (const prize of planWeeklyTribePrizes({ leagueId, week, prizes, winningTribeId, members })) {
    const result = await applySurvivorReward({
      leagueId,
      idempotencyKey: prize.idempotencyKey,
      source: { kind: 'weekly_prize', id: `${week}:${winningTribeId}`, label: `Week ${week} tribe prize` },
      week,
      reward: prize.spec,
    })
    if (result.ok && !result.duplicate) paid.push(result.rewardId)
    if (!result.ok) console.warn('[survivor] weekly prize not paid', prize.idempotencyKey, result.error)
  }
  return { paid }
}

export async function runSurvivorRewardOpenStep(leagueId: string, week: number): Promise<void> {
  await applyDueDeferredSurvivorRewards(leagueId, week).catch((error) => {
    console.warn('[survivor] deferred rewards failed', error instanceof Error ? error.message : error)
  })
  const { runChimmyRewardChoices } = await import('./chimmyRewards')
  await runChimmyRewardChoices(leagueId).catch((error) => {
    console.warn('[survivor] Chimmy reward choices failed', error instanceof Error ? error.message : error)
  })
}
