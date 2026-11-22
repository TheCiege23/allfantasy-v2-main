import type { ScoringCategory, SportConfigFull } from './types'
import {
  expandSportConfigToggles,
  getRosterSlots,
  getScoringCategories,
  resolveSportConfigKey,
  tryGetSportConfig,
} from './index'
import { prisma } from '@/lib/prisma'

type LeagueAIContext = {
  sport: string
  displayName: string
  scoringSystem: string
  scoringCategories: ScoringCategory[]
  activeToggles: string[]
  rosterSlots: ReturnType<typeof getRosterSlots>
  leagueFormat: string | null
  seasonWeeks: number
  playoffStartWeek: number
  playoffTeams: number
  lineupLockType: string
  hasIDP: boolean
  hasSuperflex: boolean
  hasTEPremium: boolean
  isPPR: boolean
  isHalfPPR: boolean
  aiMetadata: Record<string, unknown>
  contextSummary: string
}

function readSportConfigBlob(league: { settings: unknown }): Record<string, unknown> {
  const s = league.settings as Record<string, unknown> | null | undefined
  const raw = s?.sportConfig
  return raw && typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
}

function togglesFromBlob(sc: Record<string, unknown>): string[] {
  const t: string[] = []
  if (sc.enableIDP === true) t.push('IDP')
  if (sc.enableSuperflex === true) t.push('SUPERFLEX')
  if (sc.enableTEPremium === true) t.push('TE_PREMIUM')
  return t
}

function buildContextSummary(
  config: SportConfigFull,
  settings: Record<string, unknown>,
  toggles: string[],
): string {
  const preset = String(settings.scoringPreset ?? 'PPR')
  let scoringLabel = 'custom scoring'
  if (preset === 'PPR' || preset === 'HALF_PPR' || preset === 'STANDARD' || preset === 'CUSTOM') {
    if (preset === 'PPR') scoringLabel = 'PPR (1 pt per reception)'
    else if (preset === 'HALF_PPR') scoringLabel = 'Half PPR (0.5 pt per reception)'
    else if (preset === 'STANDARD') scoringLabel = 'Standard (no reception points)'
    else scoringLabel = 'Custom scoring'
  }
  const parts: string[] = [
    `This is a ${scoringLabel} ${config.displayName} fantasy league.`,
  ]
  if (toggles.includes('IDP')) parts.push('Individual defensive players (IDP) are enabled.')
  if (toggles.includes('SUPERFLEX')) parts.push('Superflex is enabled — quarterbacks gain extra lineup flexibility.')
  if (toggles.includes('TE_PREMIUM')) parts.push('Tight end premium (extra points per TE reception) is enabled.')
  const sw = Number(settings.seasonWeeks ?? config.defaultSeasonWeeks)
  const pw = Number(settings.playoffStartWeek ?? config.defaultPlayoffStartWeek)
  parts.push(`Regular season length: ${sw} weeks. Playoffs start week ${pw}.`)
  return parts.join(' ')
}

/**
 * Deterministic league context for Chimmy / redraft AI — load from DB + centralized SportConfig.
 */
export async function buildLeagueAIContext(leagueId: string): Promise<LeagueAIContext> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      sport: true,
      leagueType: true,
      settings: true,
      playoffStartWeek: true,
      playoffTeams: true,
    },
  })
  if (!league) {
    throw new Error(`League not found: ${leagueId}`)
  }

  const sport = resolveSportConfigKey(String(league.sport))
  const config = tryGetSportConfig(sport)
  if (!config) {
    throw new Error(`Unknown sport for AI context: ${sport}`)
  }
  const sc = readSportConfigBlob(league)
  const toggles = togglesFromBlob(sc)
  const expanded = expandSportConfigToggles(toggles)
  const scoringPreset = String(sc.scoringPreset ?? 'PPR')

  const seasonWeeks = Number(sc.seasonWeeks ?? config.defaultSeasonWeeks)
  const playoffStartWeek = Number(sc.playoffStartWeek ?? league.playoffStartWeek ?? config.defaultPlayoffStartWeek)
  const playoffTeams = Number(sc.playoffTeams ?? league.playoffTeams ?? config.defaultPlayoffTeams)

  const summary = buildContextSummary(config, sc, toggles)

  return {
    sport: config.sport,
    displayName: config.displayName,
    scoringSystem: scoringPreset || config.defaultScoringSystem,
    scoringCategories: getScoringCategories(config.sport, expanded),
    activeToggles: toggles,
    rosterSlots: getRosterSlots(config.sport, expanded),
    leagueFormat: league.leagueType ?? null,
    seasonWeeks,
    playoffStartWeek,
    playoffTeams,
    lineupLockType: config.lineupLockType,
    hasIDP: toggles.includes('IDP'),
    hasSuperflex: toggles.includes('SUPERFLEX'),
    hasTEPremium: toggles.includes('TE_PREMIUM'),
    isPPR: scoringPreset === 'PPR',
    isHalfPPR: scoringPreset === 'HALF_PPR',
    aiMetadata: { ...(config.aiMetadata as Record<string, unknown>) },
    contextSummary: summary,
  }
}

/** Short block to append to model prompts (redraft AI, Chimmy). */
export function formatLeagueAIContextForPrompt(ctx: LeagueAIContext): string {
  return `League context:\n${ctx.contextSummary}\nSport: ${ctx.displayName}. Lineups: ${ctx.lineupLockType}.`
}

export async function formatLeagueAIContextPromptByLeagueId(leagueId: string): Promise<string | null> {
  try {
    const ctx = await buildLeagueAIContext(leagueId)
    return formatLeagueAIContextForPrompt(ctx)
  } catch {
    return null
  }
}
