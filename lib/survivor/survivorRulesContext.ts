import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import type { SurvivorRulesContext } from './survivorRulesAnswers'

/** The settings, plan and live cast count the rules answers are built from. Null for an unknown league. */
export async function loadSurvivorRulesContext(leagueId: string): Promise<SurvivorRulesContext | null> {
  const [row, activeCount] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } }),
    prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }),
  ])
  if (!row) return null
  const raw = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings as Record<string, unknown> : {}
  return { sport: String(row.sport ?? 'NFL'), settings: normalizeSurvivorFoundationSettings(raw), plan: readSurvivorFullSeasonPlan(raw), activeCount }
}
