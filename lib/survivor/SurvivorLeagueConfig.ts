/**
 * Load and validate Survivor league config from DB (PROMPT 346).
 * Sport-aware defaults per PROMPT 344 / sport-scope.
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import { DEFAULT_MERGE_WEEK_BY_SPORT } from './constants'
import { DEFAULT_SURVIVOR_ENGINE_SPEC_V2 } from './survivor-engine-spec-v2'
import { readSurvivorVisualThemeId, withSurvivorVisualTheme } from './survivorVisuals'
import type { SurvivorConfig, SurvivorMode, TribeFormation, MergeTrigger } from './types'

export async function isSurvivorLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.survivorLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === 'survivor'
}

function toMode(s: unknown): SurvivorMode {
  if (s === 'bestball') return 'bestball'
  return 'redraft'
}

function toTribeFormation(s: unknown): TribeFormation {
  if (s === 'commissioner') return 'commissioner'
  return 'random'
}

function toMergeTrigger(s: unknown): MergeTrigger {
  if (s === 'player_count') return 'player_count'
  return 'week'
}

export async function getSurvivorConfig(leagueId: string): Promise<SurvivorConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport

  const row = await prisma.survivorLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    const defaultMergeWeek = DEFAULT_MERGE_WEEK_BY_SPORT[sport] ?? 10
    return {
      leagueId: row.leagueId,
      configId: row.id,
      mode: toMode(row.mode),
      tribeCount: row.tribeCount,
      tribeSize: row.tribeSize,
      tribeFormation: toTribeFormation(row.tribeFormation),
      mergeTrigger: toMergeTrigger(row.mergeTrigger),
      mergeWeek: row.mergeWeek ?? defaultMergeWeek,
      mergePlayerCount: row.mergePlayerCount ?? null,
      juryStartAfterMerge: row.juryStartAfterMerge,
      exileReturnEnabled: row.exileReturnEnabled,
      exileReturnTokens: row.exileReturnTokens,
      idolCount: row.idolCount,
      idolPowerPool: Array.isArray(row.idolPowerPool) ? (row.idolPowerPool as string[]) : null,
      tribeShuffleEnabled: row.tribeShuffleEnabled,
      tribeShuffleConsecutiveLosses: row.tribeShuffleConsecutiveLosses,
      tribeShuffleImbalanceThreshold: row.tribeShuffleImbalanceThreshold,
      voteDeadlineDayOfWeek: row.voteDeadlineDayOfWeek,
      voteDeadlineTimeUtc: row.voteDeadlineTimeUtc,
      selfVoteDisallowed: row.selfVoteDisallowed,
      tribalCouncilDayOfWeek: row.tribalCouncilDayOfWeek,
      tribalCouncilTimeUtc: row.tribalCouncilTimeUtc,
      minigameFrequency: row.minigameFrequency ?? 'none',
      seasonThemeLabel: row.seasonThemeLabel ?? null,
      visualThemeId: readSurvivorVisualThemeId(row.engineSpecV2, row.leagueId),
      challengesSystemRun: row.challengesSystemRun ?? true,
      regularSeasonEndWeek: row.regularSeasonEndWeek ?? null,
      faqSeededAt: row.faqSeededAt?.toISOString() ?? null,
    }
  }

  if (league.leagueVariant !== 'survivor') return null
  const defaultMergeWeek = DEFAULT_MERGE_WEEK_BY_SPORT[sport] ?? 10
  return {
    leagueId: league.id,
    configId: '',
    mode: 'redraft',
    tribeCount: 3,
    tribeSize: 4,
    tribeFormation: 'random',
    mergeTrigger: 'week',
    mergeWeek: defaultMergeWeek,
    mergePlayerCount: null,
    juryStartAfterMerge: 1,
    exileReturnEnabled: false,
    exileReturnTokens: 4,
    idolCount: 2,
    idolPowerPool: null,
    tribeShuffleEnabled: false,
    tribeShuffleConsecutiveLosses: null,
    tribeShuffleImbalanceThreshold: null,
    voteDeadlineDayOfWeek: null,
    voteDeadlineTimeUtc: null,
    selfVoteDisallowed: true,
    tribalCouncilDayOfWeek: null,
    tribalCouncilTimeUtc: null,
    minigameFrequency: 'none',
    seasonThemeLabel: null,
    visualThemeId: readSurvivorVisualThemeId(DEFAULT_SURVIVOR_ENGINE_SPEC_V2, league.id),
    challengesSystemRun: true,
    regularSeasonEndWeek: null,
    faqSeededAt: null,
  }
}

export async function upsertSurvivorConfig(
  leagueId: string,
  input: Partial<{
    mode: string
    tribeCount: number
    tribeSize: number
    tribeFormation: string
    mergeTrigger: string
    mergeWeek: number | null
    mergePlayerCount: number | null
    juryStartAfterMerge: number
    exileReturnEnabled: boolean
    exileReturnTokens: number
    idolCount: number
    idolPowerPool: string[] | object
    tribeShuffleEnabled: boolean
    tribeShuffleConsecutiveLosses: number | null
    tribeShuffleImbalanceThreshold: number | null
    voteDeadlineDayOfWeek: number | null
    voteDeadlineTimeUtc: string | null
    selfVoteDisallowed: boolean
    tribalCouncilDayOfWeek: number | null
    tribalCouncilTimeUtc: string | null
    minigameFrequency: string
    seasonThemeLabel: string | null
    challengesSystemRun: boolean
    regularSeasonEndWeek: number | null
    engineSpecV2: object | null
  }>
): Promise<SurvivorConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const defaultMergeWeek = DEFAULT_MERGE_WEEK_BY_SPORT[sport] ?? 10

  await prisma.survivorLeagueConfig.upsert({
    where: { leagueId },
    create: {
      leagueId,
      mode: input.mode ?? 'redraft',
      tribeCount: Math.min(5, Math.max(2, input.tribeCount ?? 3)),
      tribeSize: input.tribeSize ?? 4,
      tribeFormation: input.tribeFormation ?? 'random',
      mergeTrigger: input.mergeTrigger ?? 'week',
      mergeWeek: input.mergeWeek ?? defaultMergeWeek,
      mergePlayerCount: input.mergePlayerCount ?? null,
      juryStartAfterMerge: input.juryStartAfterMerge ?? 1,
      exileReturnEnabled: input.exileReturnEnabled ?? false,
      exileReturnTokens: input.exileReturnTokens ?? 4,
      idolCount: input.idolCount ?? 2,
      idolPowerPool: (Array.isArray(input.idolPowerPool) ? input.idolPowerPool : undefined) as object | undefined,
      tribeShuffleEnabled: input.tribeShuffleEnabled ?? false,
      tribeShuffleConsecutiveLosses: input.tribeShuffleConsecutiveLosses ?? null,
      tribeShuffleImbalanceThreshold: input.tribeShuffleImbalanceThreshold ?? null,
      voteDeadlineDayOfWeek: input.voteDeadlineDayOfWeek ?? null,
      voteDeadlineTimeUtc: input.voteDeadlineTimeUtc ?? null,
      selfVoteDisallowed: input.selfVoteDisallowed ?? true,
      tribalCouncilDayOfWeek: input.tribalCouncilDayOfWeek ?? null,
      tribalCouncilTimeUtc: input.tribalCouncilTimeUtc ?? null,
      minigameFrequency: input.minigameFrequency ?? 'none',
      seasonThemeLabel: input.seasonThemeLabel ?? null,
      challengesSystemRun: input.challengesSystemRun ?? true,
      regularSeasonEndWeek: input.regularSeasonEndWeek ?? null,
      engineSpecV2: withSurvivorVisualTheme(
        input.engineSpecV2 ?? DEFAULT_SURVIVOR_ENGINE_SPEC_V2,
        leagueId,
      ),
    },
    update: {
      ...(input.mode !== undefined && { mode: input.mode }),
      ...(input.tribeCount !== undefined && {
        tribeCount: Math.min(5, Math.max(2, input.tribeCount)),
      }),
      ...(input.tribeSize !== undefined && { tribeSize: input.tribeSize }),
      ...(input.tribeFormation !== undefined && { tribeFormation: input.tribeFormation }),
      ...(input.mergeTrigger !== undefined && { mergeTrigger: input.mergeTrigger }),
      ...(input.mergeWeek !== undefined && { mergeWeek: input.mergeWeek }),
      ...(input.mergePlayerCount !== undefined && { mergePlayerCount: input.mergePlayerCount }),
      ...(input.juryStartAfterMerge !== undefined && { juryStartAfterMerge: input.juryStartAfterMerge }),
      ...(input.exileReturnEnabled !== undefined && { exileReturnEnabled: input.exileReturnEnabled }),
      ...(input.exileReturnTokens !== undefined && { exileReturnTokens: input.exileReturnTokens }),
      ...(input.idolCount !== undefined && { idolCount: input.idolCount }),
      ...(input.idolPowerPool !== undefined && { idolPowerPool: (input.idolPowerPool as object) ?? undefined }),
      ...(input.tribeShuffleEnabled !== undefined && { tribeShuffleEnabled: input.tribeShuffleEnabled }),
      ...(input.tribeShuffleConsecutiveLosses !== undefined && { tribeShuffleConsecutiveLosses: input.tribeShuffleConsecutiveLosses }),
      ...(input.tribeShuffleImbalanceThreshold !== undefined && { tribeShuffleImbalanceThreshold: input.tribeShuffleImbalanceThreshold }),
      ...(input.voteDeadlineDayOfWeek !== undefined && { voteDeadlineDayOfWeek: input.voteDeadlineDayOfWeek }),
      ...(input.voteDeadlineTimeUtc !== undefined && { voteDeadlineTimeUtc: input.voteDeadlineTimeUtc }),
      ...(input.selfVoteDisallowed !== undefined && { selfVoteDisallowed: input.selfVoteDisallowed }),
      ...(input.tribalCouncilDayOfWeek !== undefined && { tribalCouncilDayOfWeek: input.tribalCouncilDayOfWeek }),
      ...(input.tribalCouncilTimeUtc !== undefined && { tribalCouncilTimeUtc: input.tribalCouncilTimeUtc }),
      ...(input.minigameFrequency !== undefined && { minigameFrequency: input.minigameFrequency }),
      ...(input.seasonThemeLabel !== undefined && { seasonThemeLabel: input.seasonThemeLabel }),
      ...(input.challengesSystemRun !== undefined && { challengesSystemRun: input.challengesSystemRun }),
      ...(input.regularSeasonEndWeek !== undefined && { regularSeasonEndWeek: input.regularSeasonEndWeek }),
      ...(input.engineSpecV2 !== undefined && {
        engineSpecV2: withSurvivorVisualTheme(input.engineSpecV2, leagueId),
      }),
    },
  })
  return getSurvivorConfig(leagueId)
}
