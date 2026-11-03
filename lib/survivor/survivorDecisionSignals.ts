import 'server-only'

import { prisma } from '@/lib/prisma'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { deriveSurvivorAttentionSignals, type SurvivorRewardSignalInput } from '@/lib/decision-os/survivorPrizeSignals'
import { listSurvivorRewards } from './survivorRewardEngine'
import { describeSurvivorReward } from './survivorRewardModel'

/**
 * The Survivor layer of the Manager Hub's Decision OS snapshot: for each of the caller's leagues
 * that is a Survivor league, the caller's OWN rewards from the reward ledger, turned into signals by
 * `lib/decision-os/survivorPrizeSignals.ts`. Read-only. Fails closed to [] — the command center is
 * useful without it, and a thrown read here must never cost the snapshot.
 */
export async function loadSurvivorDecisionSignals(args: { userId: string; leagueIds: readonly string[]; now: Date }): Promise<DecisionOsAttentionSignal[]> {
  try {
    if (!args.leagueIds.length) return []
    const leagues = await prisma.league.findMany({
      where: { id: { in: [...args.leagueIds] }, survivorMode: true },
      select: { id: true, language: true },
      take: 25,
    })
    const inputs: SurvivorRewardSignalInput[] = []
    for (const league of leagues) {
      const roster = await prisma.roster.findFirst({ where: { leagueId: league.id, platformUserId: args.userId }, select: { id: true } })
      if (!roster) continue
      const [records, game] = await Promise.all([
        listSurvivorRewards(league.id, { rosterId: roster.id }),
        prisma.survivorGameState.findUnique({ where: { leagueId: league.id }, select: { currentWeek: true } }),
      ])
      // Only rewards the manager HOLDS — points a tribemate placed on them are described from the
      // chooser's side, so they are left to Chimmy rather than mis-titled here.
      const own = records.filter((r) => r.holderRosterIds.includes(roster.id))
      inputs.push({
        leagueId: league.id,
        currentWeek: game?.currentWeek ?? null,
        language: league.language,
        rewards: own.map((r) => ({
          rewardId: r.rewardId,
          type: r.type,
          status: r.status,
          week: r.week,
          applyWeek: r.applyWeek,
          text: describeSurvivorReward(r, league.language),
          sourceKind: r.source.kind,
        })),
      })
    }
    return deriveSurvivorAttentionSignals(inputs, args.now)
  } catch (err) {
    console.error('[decision-os] survivor reward signals read failed', err)
    return []
  }
}
