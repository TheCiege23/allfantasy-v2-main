/**
 * The season runner's reward steps (survivorPlannedSeasonRunner.ts). Both are idempotent and
 * best-effort: every call is safe on every 5-minute tick, and a failure never holds up the island.
 *
 *  - `runSurvivorRewardOpenStep` (top of every week tick): deferred rewards whose week has come, and
 *    Chimmy's choices ("points on a tribemate", steal targets) for the seats it runs.
 *  - `applyWeeklyTribePrizes` (once the week's scores are final): the commissioner's weekly tribe
 *    prizes — FAAB per player for the top-scoring tribe and the top-scorer reward. Before the merge
 *    (and, with `payInTribeWeeksAfterMerge`, in a post-merge week where tribes really competed); the
 *    winning tribe is ranked with the same key-position tie-break the council uses.
 */

import { prisma } from '@/lib/prisma'
import { applyDueDeferredSurvivorRewards, applySurvivorReward } from './survivorRewardEngine'
import { loadWeekTieBreak, rankTribesByTotal, tribeTotals } from './survivorCouncilImmunity'
import { competingTribeIdsFromScores, planWeeklyTribePrizes, readSurvivorWeeklyPrizes, weeklyPrizesActive } from './survivorWeeklyPrizes'

const PRE_MERGE_PHASES = new Set(['pre_merge', 'post_swap'])

export type WeeklyPrizeOutcome = { paid: string[]; skipped?: 'off' | 'merged' | 'no_tribes' | 'no_scores' }

export async function applyWeeklyTribePrizes(leagueId: string, week: number): Promise<WeeklyPrizeOutcome> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const prizes = readSurvivorWeeklyPrizes(league?.settings)
  if (!weeklyPrizesActive(prizes)) return { paid: [], skipped: 'off' }
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } })
  if (!game) return { paid: [], skipped: 'merged' }
  const merged = Boolean(game.mergeTriggeredAt) || !PRE_MERGE_PHASES.has(game.phase)
  // After the merge: only with the commissioner's `payInTribeWeeksAfterMerge`, and only in a week
  // where tribes really competed (that week's own tribe structure — `postMergeWeekTribes`).
  if (merged && !prizes.payInTribeWeeksAfterMerge) return { paid: [], skipped: 'merged' }

  let tribeIds: string[]
  let castaways: { userId: string; tribeId: string | null; redraftRosterId: string | null }[]
  let scores: { userId: string; tribeId: string | null; finalScore: number; countedTowardTribeTotal: boolean | null }[]
  if (!merged) {
    tribeIds = (await prisma.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true } })).map((t) => t.id)
    if (tribeIds.length < 2) return { paid: [], skipped: 'no_tribes' }
    castaways = await prisma.survivorPlayer.findMany({
      where: { leagueId, playerState: 'active', tribeId: { in: tribeIds } },
      select: { userId: true, tribeId: true, redraftRosterId: true },
    })
    scores = await prisma.survivorWeeklyScore.findMany({
      where: { leagueId, week, isFinalized: true, tribeId: { not: null }, userId: { in: castaways.map((c) => c.userId) } },
      select: { userId: true, tribeId: true, finalScore: true, countedTowardTribeTotal: true },
    })
  } else {
    const week_ = await postMergeWeekTribes(leagueId, week)
    if (!week_) return { paid: [], skipped: 'no_tribes' }
    tribeIds = week_.tribeIds
    scores = week_.scores
    // Membership is the tribe each manager scored for THAT week (the surprise tribes may already be
    // dissolved back into the merged tribe), restricted to castaways still in the game.
    const tribeOf = new Map(scores.map((s) => [s.userId, s.tribeId]))
    castaways = (await prisma.survivorPlayer.findMany({
      where: { leagueId, playerState: 'active', userId: { in: scores.map((s) => s.userId) } },
      select: { userId: true, tribeId: true, redraftRosterId: true },
    })).map((c) => ({ ...c, tribeId: tribeOf.get(c.userId) ?? null }))
  }
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

/**
 * A post-merge week's competing tribes: the surprise two-tribe week's tribes when one is live, else
 * the distinct non-merged tribes on that week's finalized score rows. Null (pay nothing) unless at
 * least two tribes competed.
 */
async function postMergeWeekTribes(leagueId: string, week: number) {
  const { getActiveSurpriseTribeWeek } = await import('./survivorSurpriseTribes')
  const surprise = await getActiveSurpriseTribeWeek(leagueId, week).catch(() => null)
  const mergedTribeIds = (await prisma.survivorTribe.findMany({ where: { leagueId, isMerged: true }, select: { id: true } })).map((t) => t.id)
  const rows = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week, isFinalized: true, tribeId: { not: null } },
    select: { userId: true, tribeId: true, finalScore: true, countedTowardTribeTotal: true },
  })
  const tribeIds = surprise?.tribeIds?.length ? [...surprise.tribeIds].sort() : competingTribeIdsFromScores(rows, mergedTribeIds)
  if (tribeIds.length < 2) return null
  return { tribeIds, scores: rows.filter((r) => r.tribeId && tribeIds.includes(r.tribeId)) }
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
