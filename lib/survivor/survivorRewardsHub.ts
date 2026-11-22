import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  challengeLang,
  prizePhaseError,
  prizePhaseOf,
  prizeTypeOfRewardSpecType,
  readPrizePhaseRules,
  type SurvivorPrizePhase,
} from './survivorChallengeBuilderModel'

/**
 * The Commissioner Hub's rewards panel, server half: who can receive a reward (the cast, with tribes),
 * the current week and the prize phase — and the per-phase prize rule check for a hand-granted
 * reward (`grant_reward`). The reward ledger itself comes from `listSurvivorRewards`.
 * Reads our DB only.
 */

const PRE_MERGE = new Set(['pre_merge', 'post_swap'])

export type RewardHubCastaway = { rosterId: string; name: string; tribeId: string | null; state: string }
export type RewardHubTribe = { id: string; name: string }

export async function loadRewardHubCast(leagueId: string): Promise<{
  cast: RewardHubCastaway[]
  tribes: RewardHubTribe[]
  currentWeek: number
  phase: SurvivorPrizePhase
  allowedPrizeTypes: string[]
}> {
  const [players, tribes, game, league] = await Promise.all([
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { redraftRosterId: true, displayName: true, tribeId: true, playerState: true } }),
    prisma.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true, name: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true, mergeTriggeredAt: true } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
  ])
  const merged = Boolean(game?.mergeTriggeredAt) || (game?.phase != null && !PRE_MERGE.has(game.phase))
  const phase = prizePhaseOf(game?.phase ?? null, merged)
  return {
    cast: players
      .flatMap((p) => (p.redraftRosterId ? [{ rosterId: p.redraftRosterId, name: p.displayName, tribeId: p.tribeId, state: p.playerState }] : []))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tribes: tribes.sort((a, b) => a.name.localeCompare(b.name)),
    currentWeek: Math.max(1, game?.currentWeek ?? 1),
    phase,
    allowedPrizeTypes: readPrizePhaseRules(league?.settings)[phase],
  }
}

/**
 * The commissioner's per-phase prize rules applied to a hand-granted reward: null when allowed (or
 * when the reward is a penalty, which is never restricted), else the EN/ES refusal. Fails OPEN on a
 * read error — a rule check must never strand a commissioner fixing a mistake.
 */
export async function grantRewardPhaseError(leagueId: string, rewardType: unknown): Promise<string | null> {
  const type = typeof rewardType === 'string' ? prizeTypeOfRewardSpecType(rewardType) : null
  if (!type) return null
  try {
    const [league, game] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } }),
      prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } }),
    ])
    const merged = Boolean(game?.mergeTriggeredAt) || (game?.phase != null && !PRE_MERGE.has(game.phase))
    const phase = prizePhaseOf(game?.phase ?? null, merged)
    return prizePhaseError(type, phase, readPrizePhaseRules(league?.settings), challengeLang(league?.language))?.message ?? null
  } catch (error) {
    console.warn('[survivor] reward phase check skipped', error instanceof Error ? error.message : error)
    return null
  }
}
