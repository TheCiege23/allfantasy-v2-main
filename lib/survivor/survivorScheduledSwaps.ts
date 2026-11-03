import 'server-only'

import { prisma } from '@/lib/prisma'
import { readSurvivorGovernanceSettings, scheduledSwapForWeek, type SurvivorScheduledSwap } from './survivorGovernanceSettings'
import { sealTribeSwap } from './tribeSwapService'

/**
 * Tribe swaps beyond the setup screen's single swap week: the commissioner's schedule (any number of
 * weeks, each with its own swap type) and the Hub's "swap now". Both seal through `sealTribeSwap`, so
 * the draw stays secret until the next lineup lock and the reveal moves memberships and huddles in one
 * transaction, exactly like the original swap.
 */

const SWAP_PHASES = new Set(['pre_merge', 'post_swap', 'active', 'tribe'])

export type ScheduledSwapOutcome = 'none' | 'already_drawn' | 'sealed' | 'skipped'

/**
 * The season runner's step, called once a week's council has been read and before the week advances:
 * seal that week's scheduled swap. Idempotent (a swap row for the week, or a recorded skip, ends it)
 * and best-effort — a swap that cannot be drawn is recorded and the island carries on.
 */
export async function ensureScheduledTribeSwap(leagueId: string, week: number, now = new Date()): Promise<ScheduledSwapOutcome> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const swap = scheduledSwapForWeek(readSurvivorGovernanceSettings(league?.settings), week)
  if (!swap) return 'none'
  const [drawn, skipped, game] = await Promise.all([
    prisma.survivorTribeSwap.findFirst({ where: { leagueId, week }, select: { id: true } }),
    prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'scheduled_swap_skipped' }, select: { id: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } }),
  ])
  if (drawn) return 'already_drawn'
  if (skipped) return 'skipped'
  const skip = async (reason: string) => {
    await prisma.survivorAuditEntry.create({ data: { leagueId, week, category: 'tribe', action: 'scheduled_swap_skipped', data: { reason, mode: swap.mode }, isVisibleToCommissioner: true, isVisibleToPublic: false } })
    return 'skipped' as const
  }
  if (!game || game.mergeTriggeredAt || !SWAP_PHASES.has(game.phase)) return skip('tribes_merged_or_not_running')
  try {
    await sealTribeSwap(leagueId, week, swap.mode, now, { swap })
    return 'sealed'
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[survivor-swap] scheduled swap skipped', { leagueId, week, reason })
    return skip(reason)
  }
}

export type CommissionerSwapResult =
  | { ok: true; swapId: string; revealAt: string }
  | { ok: false; status: 409 | 422; error: string }

/** The Hub's "swap now": seal a swap of any type this week, revealed at the next lineup lock. */
export async function sealCommissionerTribeSwap(leagueId: string, swap: SurvivorScheduledSwap, actorUserId: string, now = new Date()): Promise<CommissionerSwapResult> {
  const [game, pending] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true, activeCouncilId: true, currentWeek: true } }),
    prisma.survivorTribeSwap.findFirst({ where: { leagueId, revealAt: { not: null }, revealedAt: null }, select: { id: true } }),
  ])
  if (!game || game.mergeTriggeredAt || !SWAP_PHASES.has(game.phase)) return { ok: false, status: 409, error: 'Tribes can swap only before the merge.' }
  if (game.activeCouncilId) return { ok: false, status: 409, error: 'Finish the open Tribal Council before swapping tribes.' }
  if (pending) return { ok: false, status: 409, error: 'A swap is already sealed. Reveal it before drawing another.' }
  try {
    const sealed = await sealTribeSwap(leagueId, Math.max(1, game.currentWeek), swap.mode, now, { swap, actorUserId })
    return { ok: true, swapId: sealed.id, revealAt: sealed.revealAt.toISOString() }
  } catch (error) {
    return { ok: false, status: 422, error: error instanceof Error ? error.message : 'The swap could not be drawn.' }
  }
}
