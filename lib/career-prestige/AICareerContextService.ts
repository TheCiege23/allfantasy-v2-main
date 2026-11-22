/**
 * AICareerContextService — build combined career context for AI narrative explanations.
 * Powers "Explain career", dynasty recognition, and historical storytelling.
 */

import { getUnifiedCareerProfile } from './UnifiedCareerQueryService'
import { getLeaguePrestigeSummary } from './UnifiedCareerQueryService'
import type { LeaguePrestigeSummary, AICareerContextPayload } from './types'
import { resolveSportForCareer } from './SportPrestigeResolver'
import { DEFAULT_SPORT } from '@/lib/sport-scope'

/**
 * Build AI context for a manager's career (all systems combined). Use in explain endpoints and narrative panels.
 */
export async function buildCareerContextForManager(
  managerId: string,
  options?: { leagueId?: string | null; sport?: string | null }
): Promise<AICareerContextPayload> {
  const profile = await getUnifiedCareerProfile(managerId, options)
  const sport = profile.sport ?? resolveSportForCareer(options?.sport ?? DEFAULT_SPORT)

  const parts: string[] = []
  if (profile.gmEconomy) {
    parts.push(
      `GM Economy: ${profile.gmEconomy.tierLabel ?? 'N/A'}, franchise value ${profile.gmEconomy.franchiseValue.toFixed(0)}, ` +
        `${profile.gmEconomy.championshipCount} championships, ${(profile.gmEconomy.careerWinPercentage * 100).toFixed(0)}% win rate.`
    )
  }
  if (profile.xp) {
    parts.push(
      `Career XP: ${profile.xp.totalXP} XP, tier ${profile.xp.currentTier}, ${profile.xp.progressInTier}% through tier.`
    )
  }
  if (profile.reputation) {
    parts.push(`Reputation: ${profile.reputation.tier}, score ${profile.reputation.overallScore.toFixed(1)}.`)
  }
  if (profile.legacy) {
    parts.push(
      `Legacy: overall ${profile.legacy.overallLegacyScore.toFixed(1)}, championship score ${profile.legacy.championshipScore.toFixed(1)}.`
    )
  }
  parts.push(`Hall of Fame: ${profile.hallOfFameEntryCount} entries.`)
  parts.push(`Awards: ${profile.awardsWonCount}. Record book: ${profile.recordsHeldCount} records.`)
  if (profile.timelineHints.length > 0) {
    parts.push(`Timeline: ${profile.timelineHints.slice(0, 5).join('; ')}.`)
  }

  const narrativeHint = parts.join(' ')

  return {
    managerId,
    leagueId: profile.leagueId,
    sport,
    narrativeHint,
    gmTier: profile.gmEconomy?.tierLabel ?? null,
    xpTier: profile.xp?.currentTier ?? null,
    reputationTier: profile.reputation?.tier ?? null,
    legacyScore: profile.legacy?.overallLegacyScore ?? null,
    hofCount: profile.hallOfFameEntryCount,
    awardsCount: profile.awardsWonCount,
    recordsCount: profile.recordsHeldCount,
  }
}

/**
 * Build AI context for a league's prestige (for league dashboards and storytelling).
 */
export async function buildCareerContextForLeague(
  leagueId: string,
  sport?: string | null
): Promise<{
  leagueId: string
  sport: string
  narrativeHint: string
  summary: LeaguePrestigeSummary
}> {
  const sportNorm = resolveSportForCareer(sport ?? DEFAULT_SPORT)
  const summary = await getLeaguePrestigeSummary(leagueId, sportNorm)

  const parts: string[] = []
  parts.push(
    `League has ${summary.managerCount} managers. GM Economy coverage: ${summary.gmEconomyCoverage}; XP: ${summary.xpCoverage}; Reputation: ${summary.reputationCoverage}; Legacy: ${summary.legacyCoverage}.`
  )
  parts.push(
    `Hall of Fame: ${summary.hallOfFameEntryCount} entries. Awards: ${summary.awardsCount}. Record book: ${summary.recordBookCount} records.`
  )
  if (summary.topLegacyScore != null) {
    parts.push(`Top legacy score: ${summary.topLegacyScore.toFixed(1)}.`)
  }
  if (summary.topXP != null) {
    parts.push(`Top XP: ${summary.topXP}.`)
  }

  return {
    leagueId,
    sport: summary.sport,
    narrativeHint: parts.join(' '),
    summary,
  }
}
