import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import type { SurvivorRulesContext } from './survivorRulesAnswers'
import { survivorIdolConfigFallback } from './survivorIdolConfigService'
import { readSurvivorHouseRules, readSurvivorWeeklyPrizes } from './survivorWeeklyPrizes'
import { readSurvivorFinaleSettings, readSurvivorFinaleWindows } from './survivorFinaleSettings'
import { readChallengeFaabWeeklyCap } from './survivorChallengeBuilderModel'
import { prizeLabel, readRealGameSettings, realGameLang } from './survivorRealGameChallengeLogic'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { readSurvivorSideGameSettings } from './survivorSideGameSettings'
import { readThievesCannotStealFromEachOther } from './survivorRewardModel'

/** The settings, plan and live cast count the rules answers are built from. Null for an unknown league. */
export async function loadSurvivorRulesContext(leagueId: string): Promise<SurvivorRulesContext | null> {
  const [row, activeCount, idolRow] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true, survivorIdolCount: true, language: true, survivorExileHarshTokenLoss: true } }),
    prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }),
    // The idol tables may not be migrated yet; the fallback covers that.
    Promise.resolve().then(() => prisma.survivorIdolConfig.findUnique({ where: { leagueId }, select: { count: true } })).catch(() => null),
  ])
  if (!row) return null
  const raw = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings as Record<string, unknown> : {}
  // The idols actually hidden come from the idol setup, not the foundation's idolCount.
  const idolCount = idolRow?.count ?? survivorIdolConfigFallback(row).count
  return {
    sport: String(row.sport ?? 'NFL'),
    settings: { ...normalizeSurvivorFoundationSettings(raw), idolCount },
    plan: readSurvivorFullSeasonPlan(raw),
    activeCount,
    prizes: readSurvivorWeeklyPrizes(raw),
    rewardRules: { thievesCannotStealFromEachOther: readThievesCannotStealFromEachOther(raw) },
    houseRules: readSurvivorHouseRules(raw) || null,
    governance: readSurvivorGovernanceSettings(raw),
    sideGames: readSurvivorSideGameSettings(raw, { harshTokenLoss: row.survivorExileHarshTokenLoss }),
    language: row.language ?? null,
    finale: readSurvivorFinaleSettings(raw),
    finaleWindows: readSurvivorFinaleWindows(raw),
    challenges: (() => {
      const realGame = readRealGameSettings(raw)
      return { faabWeeklyCap: readChallengeFaabWeeklyCap(raw), realGame: { enabled: realGame.enabled, perWeek: realGame.perWeek, prizeText: prizeLabel(realGame.prize, realGameLang(row.language)) } }
    })(),
  }
}
