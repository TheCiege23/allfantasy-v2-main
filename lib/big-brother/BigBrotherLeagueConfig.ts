/**
 * [NEW] lib/big-brother/BigBrotherLeagueConfig.ts
 * Load and upsert Big Brother league config. Sport-aware defaults.
 * PROMPT 2/6.
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import {
  DEFAULT_VETO_COMPETITOR_COUNT,
  FINAL_NOMINEE_COUNT,
  DEFAULT_JURY_START_AFTER_ELIMINATIONS,
} from './constants'
import type {
  BigBrotherConfig,
  JuryStartMode,
  FinaleFormat,
  WaiverReleaseTiming,
  PublicVoteTotalsVisibility,
  ChallengeMode,
  InactivePlayerHandling,
  AutoNominationFallback,
} from './types'

function toJuryStartMode(s: unknown): JuryStartMode {
  if (s === 'when_remaining' || s === 'fixed_week') return s
  return 'after_eliminations'
}

function toFinaleFormat(s: unknown): FinaleFormat {
  if (s === 'final_3') return 'final_3'
  return 'final_2'
}

function toWaiverReleaseTiming(s: unknown): WaiverReleaseTiming {
  if (s === 'immediate' || s === 'faab_window') return s
  return 'next_waiver_run'
}

function toPublicVoteTotalsVisibility(s: unknown): PublicVoteTotalsVisibility {
  if (s === 'exact') return 'exact'
  return 'evicted_only'
}

function toChallengeMode(s: unknown): ChallengeMode {
  if (s === 'ai_theme' || s === 'deterministic_score') return s
  return 'hybrid'
}

function toInactivePlayerHandling(s: unknown): InactivePlayerHandling {
  if (s === 'replacement_after_n_weeks' || s === 'commissioner_only') return s
  return 'none'
}

function toAutoNominationFallback(s: unknown): AutoNominationFallback {
  if (s === 'random' || s === 'commissioner') return s
  return 'lowest_season_points'
}

function toEvictionTieBreakMode(s: unknown): string {
  if (s === 'hoh_vote' || s === 'random' || s === 'commissioner') return s
  return 'season_points'
}

export async function isBigBrotherLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.bigBrotherLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === 'big_brother'
}

export async function getBigBrotherConfig(leagueId: string): Promise<BigBrotherConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport

  const row = await prisma.bigBrotherLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    return {
      leagueId: row.leagueId,
      configId: row.id,
      sport,
      hohChallengeDayOfWeek: row.hohChallengeDayOfWeek,
      hohChallengeTimeUtc: row.hohChallengeTimeUtc,
      nominationDeadlineDayOfWeek: row.nominationDeadlineDayOfWeek,
      nominationDeadlineTimeUtc: row.nominationDeadlineTimeUtc,
      vetoDrawDayOfWeek: row.vetoDrawDayOfWeek,
      vetoDrawTimeUtc: row.vetoDrawTimeUtc,
      vetoDecisionDeadlineDayOfWeek: row.vetoDecisionDeadlineDayOfWeek,
      vetoDecisionDeadlineTimeUtc: row.vetoDecisionDeadlineTimeUtc,
      replacementNomineeDeadlineDayOfWeek: row.replacementNomineeDeadlineDayOfWeek,
      replacementNomineeDeadlineTimeUtc: row.replacementNomineeDeadlineTimeUtc,
      evictionVoteOpenDayOfWeek: row.evictionVoteOpenDayOfWeek,
      evictionVoteOpenTimeUtc: row.evictionVoteOpenTimeUtc,
      evictionVoteCloseDayOfWeek: row.evictionVoteCloseDayOfWeek,
      evictionVoteCloseTimeUtc: row.evictionVoteCloseTimeUtc,
      finalNomineeCount: row.finalNomineeCount,
      vetoCompetitorCount: row.vetoCompetitorCount,
      consecutiveHohAllowed: row.consecutiveHohAllowed,
      hohVotesOnlyInTie: row.hohVotesOnlyInTie,
      juryStartMode: toJuryStartMode(row.juryStartMode),
      juryStartAfterEliminations: row.juryStartAfterEliminations,
      juryStartWhenRemaining: row.juryStartWhenRemaining,
      juryStartWeek: row.juryStartWeek,
      finaleFormat: toFinaleFormat(row.finaleFormat),
      waiverReleaseTiming: toWaiverReleaseTiming(row.waiverReleaseTiming),
      publicVoteTotalsVisibility: toPublicVoteTotalsVisibility(row.publicVoteTotalsVisibility),
      challengeMode: toChallengeMode(row.challengeMode),
      antiCollusionLogging: row.antiCollusionLogging,
      inactivePlayerHandling: toInactivePlayerHandling(row.inactivePlayerHandling),
      autoNominationFallback: toAutoNominationFallback(row.autoNominationFallback),
      evictionTieBreakMode: toEvictionTieBreakMode((row as { evictionTieBreakMode?: string }).evictionTieBreakMode),
      weekProgressionPaused: (row as { weekProgressionPaused?: boolean }).weekProgressionPaused ?? false,
      premiumEngineSpec: (row as { premiumEngineSpec?: unknown | null }).premiumEngineSpec ?? null,
    }
  }

  if (league.leagueVariant !== 'big_brother') return null
  return {
    leagueId: league.id,
    configId: '',
    sport,
    hohChallengeDayOfWeek: null,
    hohChallengeTimeUtc: null,
    nominationDeadlineDayOfWeek: null,
    nominationDeadlineTimeUtc: null,
    vetoDrawDayOfWeek: null,
    vetoDrawTimeUtc: null,
    vetoDecisionDeadlineDayOfWeek: null,
    vetoDecisionDeadlineTimeUtc: null,
    replacementNomineeDeadlineDayOfWeek: null,
    replacementNomineeDeadlineTimeUtc: null,
    evictionVoteOpenDayOfWeek: null,
    evictionVoteOpenTimeUtc: null,
    evictionVoteCloseDayOfWeek: null,
    evictionVoteCloseTimeUtc: null,
    finalNomineeCount: FINAL_NOMINEE_COUNT,
    vetoCompetitorCount: DEFAULT_VETO_COMPETITOR_COUNT,
    consecutiveHohAllowed: false,
    hohVotesOnlyInTie: true,
    juryStartMode: 'after_eliminations',
    juryStartAfterEliminations: DEFAULT_JURY_START_AFTER_ELIMINATIONS,
    juryStartWhenRemaining: null,
    juryStartWeek: null,
    finaleFormat: 'final_2',
    waiverReleaseTiming: 'next_waiver_run',
    publicVoteTotalsVisibility: 'evicted_only',
    challengeMode: 'hybrid',
    antiCollusionLogging: true,
    inactivePlayerHandling: 'commissioner_only',
    autoNominationFallback: 'lowest_season_points',
    evictionTieBreakMode: 'season_points',
    weekProgressionPaused: false,
    premiumEngineSpec: null,
  }
}

export type BigBrotherConfigUpsertInput = Partial<{
  hohChallengeDayOfWeek: number | null
  hohChallengeTimeUtc: string | null
  nominationDeadlineDayOfWeek: number | null
  nominationDeadlineTimeUtc: string | null
  vetoDrawDayOfWeek: number | null
  vetoDrawTimeUtc: string | null
  vetoDecisionDeadlineDayOfWeek: number | null
  vetoDecisionDeadlineTimeUtc: string | null
  replacementNomineeDeadlineDayOfWeek: number | null
  replacementNomineeDeadlineTimeUtc: string | null
  evictionVoteOpenDayOfWeek: number | null
  evictionVoteOpenTimeUtc: string | null
  evictionVoteCloseDayOfWeek: number | null
  evictionVoteCloseTimeUtc: string | null
  finalNomineeCount: number
  vetoCompetitorCount: number
  consecutiveHohAllowed: boolean
  hohVotesOnlyInTie: boolean
  juryStartMode: string
  juryStartAfterEliminations: number | null
  juryStartWhenRemaining: number | null
  juryStartWeek: number | null
  finaleFormat: string
  waiverReleaseTiming: string
  publicVoteTotalsVisibility: string
  challengeMode: string
  antiCollusionLogging: boolean
  inactivePlayerHandling: string
  autoNominationFallback: string
  evictionTieBreakMode: string
  weekProgressionPaused: boolean
}>

/**
 * The game's built-in rules: what a config is created with when nothing else is given. Exported so the setup-rules
 * pass (./bigBrotherSetupRules.ts) can tell a value nobody chose from one somebody set.
 */
export const BIG_BROTHER_CONFIG_DEFAULTS = {
  finalNomineeCount: FINAL_NOMINEE_COUNT,
  vetoCompetitorCount: DEFAULT_VETO_COMPETITOR_COUNT,
  consecutiveHohAllowed: false,
  hohVotesOnlyInTie: true,
  juryStartMode: 'after_eliminations',
  juryStartAfterEliminations: DEFAULT_JURY_START_AFTER_ELIMINATIONS,
  juryStartWhenRemaining: null,
  juryStartWeek: null,
  finaleFormat: 'final_2',
  waiverReleaseTiming: 'next_waiver_run',
  publicVoteTotalsVisibility: 'evicted_only',
  challengeMode: 'hybrid',
  antiCollusionLogging: true,
  inactivePlayerHandling: 'commissioner_only',
  autoNominationFallback: 'lowest_season_points',
  evictionTieBreakMode: 'season_points',
} as const

/**
 * Create the league's config (built-in defaults for anything not given), or change ONLY the given fields.
 *
 * 🛑 AN UPDATE USED TO RESET EVERYTHING IT WAS NOT GIVEN. The same defaults-filled object was written on create and
 * on update, so pausing the week (`{ weekProgressionPaused: true }`) quietly put finale format, jury start, challenge
 * mode, consecutive HOH and eight more back to their defaults — undoing whatever had been set.
 */
export async function upsertBigBrotherConfig(
  leagueId: string,
  input: BigBrotherConfigUpsertInput
): Promise<BigBrotherConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true },
  })
  if (!league) throw new Error('League not found')

  const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  await prisma.bigBrotherLeagueConfig.upsert({
    where: { leagueId },
    create: { leagueId, ...BIG_BROTHER_CONFIG_DEFAULTS, ...given } as Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['create'],
    update: given as Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['update'],
  })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) throw new Error('Big Brother config not found after upsert')
  return config
}
