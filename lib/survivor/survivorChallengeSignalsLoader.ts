import 'server-only'

import { prisma } from '@/lib/prisma'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { deriveSurvivorChallengeSignals, type SurvivorChallengeSignalInput } from '@/lib/decision-os/survivorChallengeSignals'
import { loadBuilderBoard } from './survivorChallengeBuilder'

/**
 * The challenge layer of the Manager Hub's Decision OS snapshot: for each Survivor league, the
 * manager's OWN view of the commissioner challenges (`loadBuilderBoard` — the same read the Camp card
 * uses, so the two can never disagree), turned into signals by `survivorChallengeSignals.ts`.
 * Read-only. Fails closed to [] per league.
 */
export async function loadSurvivorChallengeSignals(args: { userId: string; leagueIds: readonly string[]; now: Date }): Promise<DecisionOsAttentionSignal[]> {
  try {
    if (!args.leagueIds.length) return []
    const leagues = await prisma.league.findMany({ where: { id: { in: [...args.leagueIds] }, survivorMode: true }, select: { id: true, language: true }, take: 25 })
    const inputs: SurvivorChallengeSignalInput[] = []
    for (const league of leagues) {
      try {
        const player = await prisma.survivorPlayer.findFirst({ where: { leagueId: league.id, userId: args.userId, playerState: 'active' }, select: { userId: true } })
        if (!player) continue
        const [board, game] = await Promise.all([
          loadBuilderBoard(league.id, args.userId, args.now),
          prisma.survivorGameState.findUnique({ where: { leagueId: league.id }, select: { currentWeek: true } }),
        ])
        inputs.push({
          leagueId: league.id,
          currentWeek: game?.currentWeek ?? null,
          language: league.language,
          challenges: board.challenges.map((c) => ({
            challengeId: c.id, title: c.title, status: c.status, locksAt: c.locksAt, answered: Boolean(c.mine), scope: c.scope,
            myResult: c.myResult, week: c.week, prizeText: c.prizeText,
          })),
        })
      } catch {
        // One league failing costs only its own signals.
      }
    }
    return deriveSurvivorChallengeSignals(inputs, args.now)
  } catch (err) {
    console.error('[decision-os] survivor challenge signals read failed', err)
    return []
  }
}
