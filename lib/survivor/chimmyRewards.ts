import 'server-only'

import { prisma } from '@/lib/prisma'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { chooseSurvivorRewardTarget, listSurvivorRewards, readSurvivorFaabBalance } from './survivorRewardEngine'
import { isThiefThisWeek, pickChimmyStealTarget, pickChimmyTribemate, readThievesCannotStealFromEachOther } from './survivorRewardModel'
import { pickChimmyDisadvantageTarget } from './survivorSideGameRules'

/**
 * Chimmy's reward choices for the castaways it runs (same seats as its council turn,
 * chimmyCastaway.ts). Deterministic and spoiler-safe:
 *
 *  - "Points on a tribemate": the weakest active tribemate by season points — Chimmy keeps its
 *    tribe strong, the same reasoning it votes with before the merge.
 *  - A steal: the richest opponent in what is stolen (FAAB balance, or that week's points). Before
 *    the merge only managers on OTHER tribes; after it, anyone else. Blockers are private, so
 *    Chimmy never knows who holds one and never reads them.
 *
 * Idempotent: a reward that is no longer `awaiting_choice` is skipped.
 */
export async function runChimmyRewardChoices(leagueId: string): Promise<string[]> {
  const all = await listSurvivorRewards(leagueId)
  const pending = all.filter((r) => r.status === 'awaiting_choice')
  if (!pending.length) return []
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, userId: true } })
  if (!league) return []
  const managed = await readPlayableChimmyLineups({ id: leagueId, ...league })
  const cast = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { userId: true, tribeId: true, redraftRosterId: true },
  })
  const byRoster = new Map(cast.filter((c) => c.redraftRosterId).map((c) => [c.redraftRosterId!, c]))
  const chosen: string[] = []

  for (const reward of pending) {
    const holderRosterId = reward.holderRosterIds[0]
    const holder = holderRosterId ? byRoster.get(holderRosterId) : undefined
    if (!holder || !holderRosterId || !isSeatPlaceholderUserId(holder.userId) || !isChimmyRunning(managed, holderRosterId, holder.userId)) continue

    let target: string | null = null
    if (reward.spec.type === 'tribemate_points') {
      const mates = cast.filter((c) => c.redraftRosterId && (!holder.tribeId || c.tribeId === holder.tribeId))
      const scores = await prisma.survivorWeeklyScore.findMany({
        where: { leagueId, userId: { in: mates.map((m) => m.userId) }, isFinalized: true },
        select: { userId: true, finalScore: true },
      })
      const season = new Map<string, number>()
      for (const s of scores) season.set(s.userId, (season.get(s.userId) ?? 0) + s.finalScore)
      target = pickChimmyTribemate(
        mates.map((m) => ({ rosterId: m.redraftRosterId!, seasonPoints: season.get(m.userId) ?? 0 })),
        holderRosterId,
        reward.spec.allowSelf === true,
      )
    } else if (reward.spec.type === 'steal') {
      const what = reward.spec.what
      // "Thieves cannot steal from each other" (when the commissioner turned it on): skip anyone who
      // holds or used a steal this week — the engine would refuse them. Steals are commissioner-
      // visible ledger rows, not secrets like blockers, so reading them is fair.
      const thievesRule = readThievesCannotStealFromEachOther(league.settings)
      const rivals = cast.filter((c) => c.redraftRosterId && c.redraftRosterId !== holderRosterId && (!holder.tribeId || c.tribeId !== holder.tribeId)
        && !(thievesRule && isThiefThisWeek(all, c.redraftRosterId, reward.applyWeek, reward.rewardId)))
      const weekScores = what === 'points'
        ? await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week: reward.applyWeek, userId: { in: rivals.map((r) => r.userId) } }, select: { userId: true, finalScore: true } })
        : []
      const weekByUser = new Map(weekScores.map((s) => [s.userId, s.finalScore]))
      const candidates = await Promise.all(rivals.map(async (r) => ({
        rosterId: r.redraftRosterId!,
        faab: what === 'faab' ? ((await readSurvivorFaabBalance(prisma, leagueId, r.redraftRosterId!)) ?? 0) : 0,
        points: weekByUser.get(r.userId) ?? 0,
      })))
      target = pickChimmyStealTarget(candidates, holderRosterId, what)
    } else if (reward.spec.type === 'opponent_penalty' || reward.spec.type === 'vote_taken' || reward.spec.type === 'forced_bench') {
      // (A forced bench then sits the chosen opponent's first starter: the engine's default.)
      // A disadvantage (side-game auction / shop): the strongest opponent by season points — before
      // the merge only managers on OTHER tribes. Nothing private is read.
      const rivals = cast.filter((c) => c.redraftRosterId && c.redraftRosterId !== holderRosterId && (!holder.tribeId || c.tribeId !== holder.tribeId))
      const scores = await prisma.survivorWeeklyScore.findMany({
        where: { leagueId, userId: { in: rivals.map((r) => r.userId) }, isFinalized: true },
        select: { userId: true, finalScore: true },
      })
      const season = new Map<string, number>()
      for (const s of scores) season.set(s.userId, (season.get(s.userId) ?? 0) + s.finalScore)
      const candidates = rivals.map((r) => ({ rosterId: r.redraftRosterId!, seasonPoints: season.get(r.userId) ?? 0 }))
      target = pickChimmyDisadvantageTarget(candidates, candidates.map((c) => c.rosterId))
    }
    if (!target) continue
    const result = await chooseSurvivorRewardTarget({ leagueId, rewardId: reward.rewardId, actorRosterId: holderRosterId, targetRosterId: target, chosenBy: 'chimmy' })
    if (result.ok) chosen.push(reward.rewardId)
  }
  return chosen
}
