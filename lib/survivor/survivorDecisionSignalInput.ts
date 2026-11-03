import 'server-only'

import { prisma } from '@/lib/prisma'
import { deriveSurvivorAttentionSignals } from '@/lib/decision-os/survivorSignals'
import type { DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorGovernanceSettings, scheduledSwapForWeek } from './survivorGovernanceSettings'
import { listSurvivorConductStrikes } from './survivorConductService'
import { survivorTradeWindowStatus } from './survivorTradeRules'

/**
 * Reads the persisted facts `deriveSurvivorAttentionSignals` relabels, for the Survivor leagues among
 * a manager's leagues: governance settings, the viewer's own player row and strikes, and any swap
 * scheduled for this week or sealed and awaiting its reveal. Read-only; never throws (a league that
 * cannot be read simply contributes no signal).
 */
export async function loadSurvivorAttentionSignals(userId: string, leagueIds: readonly string[], now = new Date()): Promise<DecisionOsAttentionSignal[]> {
  if (leagueIds.length === 0) return []
  const leagues = await prisma.league.findMany({ where: { id: { in: [...leagueIds] }, survivorMode: true }, select: { id: true, settings: true, language: true } }).catch(() => [])
  const out: DecisionOsAttentionSignal[] = []
  for (const league of leagues) {
    try {
      const settings = readSurvivorGovernanceSettings(league.settings)
      const foundation = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
      const [player, game, strikes, sealed] = await Promise.all([
        prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId } }, select: { playerState: true } }),
        prisma.survivorGameState.findUnique({ where: { leagueId: league.id }, select: { currentWeek: true, mergeTriggeredAt: true } }),
        listSurvivorConductStrikes(league.id, userId),
        prisma.survivorTribeSwap.findFirst({ where: { leagueId: league.id, revealAt: { not: null }, revealedAt: null }, orderBy: { executedAt: 'desc' }, select: { week: true, revealAt: true } }),
      ])
      if (!player) continue
      const active = player.playerState === 'active'
      const merged = Boolean(game?.mergeTriggeredAt)
      const week = game?.currentWeek ?? 0
      const scheduled = !merged && week > 0 ? scheduledSwapForWeek(settings, week) : null
      out.push(...deriveSurvivorAttentionSignals({
        leagueId: league.id,
        now,
        language: league.language,
        activeCastaway: active,
        tradeWindow: active && settings.tradeRulesEnabled ? survivorTradeWindowStatus(settings, { tribalDay: foundation.tribalCouncilDay, tribalTime: foundation.tribalCouncilTime, now }, merged) : null,
        preMerge: !merged,
        myStrikeCount: strikes.length,
        strikeLimit: settings.strikeLimit,
        swap: sealed ? { week: sealed.week, revealAt: sealed.revealAt } : scheduled ? { week: scheduled.week, revealAt: null } : null,
      }))
    } catch (error) {
      console.warn('[survivor-signals] league skipped', { leagueId: league.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return out
}
