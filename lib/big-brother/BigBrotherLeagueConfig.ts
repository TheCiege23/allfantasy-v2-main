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

export async function upsertBigBrotherConfig(
  leagueId: string,
  input: BigBrotherConfigUpsertInput
): Promise<BigBrotherConfig> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true },
  })
  if (!league) throw new Error('League not found')

  const data: Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['create'] & Partial<Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['update']> = {
    leagueId,
    finalNomineeCount: input.finalNomineeCount ?? FINAL_NOMINEE_COUNT,
    vetoCompetitorCount: input.vetoCompetitorCount ?? DEFAULT_VETO_COMPETITOR_COUNT,
    consecutiveHohAllowed: input.consecutiveHohAllowed ?? false,
    hohVotesOnlyInTie: input.hohVotesOnlyInTie ?? true,
    juryStartMode: input.juryStartMode ?? 'after_eliminations',
    juryStartAfterEliminations: input.juryStartAfterEliminations ?? DEFAULT_JURY_START_AFTER_ELIMINATIONS,
    juryStartWhenRemaining: input.juryStartWhenRemaining ?? null,
    juryStartWeek: input.juryStartWeek ?? null,
    finaleFormat: input.finaleFormat ?? 'final_2',
    waiverReleaseTiming: input.waiverReleaseTiming ?? 'next_waiver_run',
    publicVoteTotalsVisibility: input.publicVoteTotalsVisibility ?? 'evicted_only',
    challengeMode: input.challengeMode ?? 'hybrid',
    antiCollusionLogging: input.antiCollusionLogging ?? true,
    inactivePlayerHandling: input.inactivePlayerHandling ?? 'commissioner_only',
    autoNominationFallback: input.autoNominationFallback ?? 'lowest_season_points',
  }
  if (input.hohChallengeDayOfWeek !== undefined) data.hohChallengeDayOfWeek = input.hohChallengeDayOfWeek
  if (input.hohChallengeTimeUtc !== undefined) data.hohChallengeTimeUtc = input.hohChallengeTimeUtc
  if (input.nominationDeadlineDayOfWeek !== undefined) data.nominationDeadlineDayOfWeek = input.nominationDeadlineDayOfWeek
  if (input.nominationDeadlineTimeUtc !== undefined) data.nominationDeadlineTimeUtc = input.nominationDeadlineTimeUtc
  if (input.vetoDrawDayOfWeek !== undefined) data.vetoDrawDayOfWeek = input.vetoDrawDayOfWeek
  if (input.vetoDrawTimeUtc !== undefined) data.vetoDrawTimeUtc = input.vetoDrawTimeUtc
  if (input.vetoDecisionDeadlineDayOfWeek !== undefined) data.vetoDecisionDeadlineDayOfWeek = input.vetoDecisionDeadlineDayOfWeek
  if (input.vetoDecisionDeadlineTimeUtc !== undefined) data.vetoDecisionDeadlineTimeUtc = input.vetoDecisionDeadlineTimeUtc
  if (input.replacementNomineeDeadlineDayOfWeek !== undefined) data.replacementNomineeDeadlineDayOfWeek = input.replacementNomineeDeadlineDayOfWeek
  if (input.replacementNomineeDeadlineTimeUtc !== undefined) data.replacementNomineeDeadlineTimeUtc = input.replacementNomineeDeadlineTimeUtc
  if (input.evictionVoteOpenDayOfWeek !== undefined) data.evictionVoteOpenDayOfWeek = input.evictionVoteOpenDayOfWeek
  if (input.evictionVoteOpenTimeUtc !== undefined) data.evictionVoteOpenTimeUtc = input.evictionVoteOpenTimeUtc
  if (input.evictionVoteCloseDayOfWeek !== undefined) data.evictionVoteCloseDayOfWeek = input.evictionVoteCloseDayOfWeek
  if (input.evictionVoteCloseTimeUtc !== undefined) data.evictionVoteCloseTimeUtc = input.evictionVoteCloseTimeUtc
  if (input.evictionTieBreakMode !== undefined) (data as Record<string, unknown>).evictionTieBreakMode = input.evictionTieBreakMode
  if (input.weekProgressionPaused !== undefined) (data as Record<string, unknown>).weekProgressionPaused = input.weekProgressionPaused

  await prisma.bigBrotherLeagueConfig.upsert({
    where: { leagueId },
    create: data as Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['create'],
    update: {
      ...data,
      leagueId: undefined,
    } as Parameters<typeof prisma.bigBrotherLeagueConfig.upsert>[0]['update'],
  })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) throw new Error('Big Brother config not found after upsert')
  return config
}
