/**
 * Unified player product view — one augmentation layer on top of NormalizedDraftEntry
 * so DraftRoom, waivers, rosters, AI, and diagnostics share the same normalized shape.
 */

import type { LeagueSport } from '@prisma/client'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import type { NflRookieSourceResolution } from '@/lib/providers/nflRookieSourcePolicy'
import { resolveNflRookieSource } from '@/lib/providers/nflRookieSourcePolicy'
import {
  getCollegeClassBucket,
  isDraftEligibleCollegeClass,
  normalizeCollegeClass,
  type NormalizedCollegeClass,
} from '@/lib/draft-room/collegeClass'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'
import { mapNflLikePositionCategory, mapSoccerPositionGroup } from '@/lib/player-data/sportSpecificPlayerFields'
import type { PlayerExperienceResult } from '@/lib/player-data/playerExperience'
import { resolvePlayerExperience } from '@/lib/player-data/playerExperience'

export type PlayerDataSurface =
  | 'draft'
  | 'waivers'
  | 'roster'
  | 'lineup'
  | 'trade'
  | 'player_card'
  | 'matchup'
  | 'ai_context'

/** Optional DB/cache augment when resolving outside the draft pipeline (waivers pool, sports_players row). */
export type UnifiedPlayerAugment = {
  /** sports_players projection cache row */
  sportsPlayerRecord?: {
    stats?: unknown
    projections?: unknown
    dataSource?: string | null
    headshotSource?: string | null
    adp?: number | null
  }
  /** Explicit soccer competition when league settings do not carry it. */
  soccerLeague?: RollingInsightsSoccerLeagueCode | null
}

export type UnifiedProductMeta = {
  /** Canonical player id used in UI/API */
  playerId: string
  /** External/provider id when distinct from internal pool id */
  providerPlayerId: string | null
  sport: LeagueSport
  soccerLeague: RollingInsightsSoccerLeagueCode | null
  fullName: string
  firstName: string | null
  lastName: string | null
  position: string
  positionCategory: string | null
  team: string | null
  teamId: string | null
  teamAbbr: string | null
  status: string | null
  jerseyNumber: number | null
  headshotUrl: string | null
  imageSource: string | null
  profileSource: string | null
  statsSource: string | null
  projectionsSource: string | null
  liveSource: string | null
  rookieSource: string | null
  adpSource: string | null
  aiAdpSource: string | null
  height: string | null
  weight: string | null
  birthDateRaw: string | null
  age: number | null
  college: string | null
  collegeClassRaw: string | null
  collegeClass: NormalizedCollegeClass
  collegeClassBucket: NormalizedCollegeClass
  isFreshman: boolean
  isUnderclassman: boolean
  isDraftEligible: boolean
  draftYear: number | null
  yearsExperience: number | null
  yearsExpSource: string | null
  adp: number | null
  aiAdp: number | null
  aiAdpSampleSize: number | null
  projectedPoints: number | null
  fantasyPointsPerGame: number | null
  normalizedStats: Record<string, unknown>
  normalizedProjections: Record<string, unknown>
  liveStats: Record<string, unknown> | null
  rawStatsReference: unknown
  isDrafted: boolean | null
  isOnRoster: boolean | null
  isOnWaivers: boolean | null
  isFreeAgent: boolean | null
  isLocked: boolean | null
  injuryStatus: string | null
  nflRookie: NflRookieSourceResolution | null
  soccerPositionGroup: ReturnType<typeof mapSoccerPositionGroup>
  /** Pro vs college experience / rookie resolution (provider-safe). */
  experience: PlayerExperienceResult
  /** Dev/diagnostic — combined source hints */
  lowConfidence: boolean
}

export type UnifiedPlayerProductView = NormalizedDraftEntry & {
  unified: UnifiedProductMeta
}

function splitDisplayName(name: string): { first: string | null; last: string | null } {
  const t = name.trim()
  if (!t) return { first: null, last: null }
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return { first: parts[0]!, last: null }
  return { first: parts[0]!, last: parts[parts.length - 1]! }
}

function safeRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}

function flattenStatSnapshot(entry: NormalizedDraftEntry): Record<string, unknown> {
  const s = entry.display.stats
  const base: Record<string, unknown> = {
    primaryStatLabel: s.primaryStatLabel ?? null,
    primaryStatValue: s.primaryStatValue ?? null,
    secondaryStatLabel: s.secondaryStatLabel ?? null,
    secondaryStatValue: s.secondaryStatValue ?? null,
    adp: s.adp ?? null,
    byeWeek: s.byeWeek ?? null,
    fantasyPointsPerGame: s.fantasyPointsPerGame ?? null,
    lifetimeValue: s.lifetimeValue ?? null,
    rollingInsightsSupplemental: s.rollingInsightsSupplemental ?? null,
    projectionSource: s.projectionSource ?? entry.projectionSource ?? null,
  }
  if (entry.nflDraftProjectionSplits && typeof entry.nflDraftProjectionSplits === 'object') {
    base.nflDraftProjectionSplits = entry.nflDraftProjectionSplits as unknown
  }
  return base
}

function readMetadataLoose(entry: NormalizedDraftEntry, key: string): unknown {
  const top = (entry as Record<string, unknown>)[key]
  if (top !== undefined) return top
  const dm = entry.display?.metadata as Record<string, unknown> | undefined
  return dm?.[key]
}

export function buildUnifiedMeta(
  entry: NormalizedDraftEntry,
  augment?: UnifiedPlayerAugment,
): UnifiedProductMeta {
  const sport = entry.display.sport
  const display = entry.display
  const meta = display.metadata
  const pid = String(display.playerId ?? entry.playerId ?? entry.name)
  const teamAbbr = meta.teamAbbreviation ?? null
  const teamModel = display.team
  const headshotUrl = display.assets?.headshotUrl ?? null
  const imgClass = classifyAvatarSource(headshotUrl)
  const imageSource =
    imgClass === 'headshot' ? 'http_headshot' : imgClass === 'synthesized' ? 'synthesized_placeholder' : imgClass

  const spr = augment?.sportsPlayerRecord
  const statsJson = spr?.stats != null ? safeRecord(spr.stats) : {}
  const projJson = spr?.projections != null ? safeRecord(spr.projections) : {}

  const soccerLeague =
    augment?.soccerLeague ??
    normalizeSoccerLeague(readMetadataLoose(entry, 'soccerLeague')) ??
    normalizeSoccerLeague(readMetadataLoose(entry, 'soccerLeagueHint')) ??
    normalizeSoccerLeague(readMetadataLoose(entry, 'competition')) ??
    null

  let nflRookie: NflRookieSourceResolution | null = null
  if (sport === 'NFL') {
    nflRookie = resolveNflRookieSource({
      ...entry,
      display: entry.display,
      yearsExp: entry.yearsExp ?? null,
      isRookie: entry.isRookie,
    })
  }

  const classRaw =
    (entry.classYearLabel ?? meta.classYearLabel ?? readMetadataLoose(entry, 'class')) != null
      ? String(entry.classYearLabel ?? meta.classYearLabel ?? readMetadataLoose(entry, 'class'))
      : null

  const collegeClass = normalizeCollegeClass(classRaw)
  const isNcaf = sport === 'NCAAF'

  const mergedStats: Record<string, unknown> = {
    ...flattenStatSnapshot(entry),
    ...(Object.keys(statsJson).length > 0 ? { cacheStats: statsJson } : {}),
  }
  const mergedProj: Record<string, unknown> = {
    projectionSource: entry.projectionSource ?? display.stats.projectionSource ?? null,
    ...(Object.keys(projJson).length > 0 ? { cacheProjections: projJson } : {}),
  }

  const profileSource = spr?.dataSource?.trim() || null
  const statsSource = spr?.dataSource?.trim() || (spr?.stats ? 'sports_players.stats' : null)
  const projectionsSource =
    spr?.dataSource?.trim() || (spr?.projections ? 'sports_players.projections' : null)
  const rookieSource = nflRookie?.source ?? null
  const adpSource = entry.adp != null ? 'pool_adp' : null
  const aiAdpSource = entry.aiAdp != null ? 'ai_adp' : null

  const soccerGrp = mapSoccerPositionGroup(meta.position)
  const posCat: string | null =
    sport === 'SOCCER' ? (soccerGrp != null ? soccerGrp : null) : mapNflLikePositionCategory(sport, meta.position)

  const lowConfidence =
    !headshotUrl ||
    imgClass !== 'headshot' ||
    (sport === 'NFL' && nflRookie?.source === 'unknown') ||
    (isNcaf && collegeClass === 'unknown')

  const experience = resolvePlayerExperience({
    sport,
    entry,
    statsJson: Object.keys(statsJson).length ? statsJson : undefined,
    projectionsJson: Object.keys(projJson).length ? projJson : undefined,
    dataSource: spr?.dataSource ?? null,
    isDevyContext: entry.isDevy,
  })

  return {
    playerId: pid,
    providerPlayerId: typeof readMetadataLoose(entry, 'externalSourceId') === 'string'
      ? String(readMetadataLoose(entry, 'externalSourceId'))
      : null,
    sport,
    soccerLeague,
    fullName: display.displayName,
    ...splitDisplayName(display.displayName),
    position: meta.position || entry.position,
    positionCategory: posCat,
    team: teamModel?.abbreviation ?? teamAbbr,
    teamId: teamModel?.teamId ?? null,
    teamAbbr,
    status: readMetadataLoose(entry, 'status') != null ? String(readMetadataLoose(entry, 'status')) : null,
    jerseyNumber:
      typeof readMetadataLoose(entry, 'jersey') === 'number'
        ? (readMetadataLoose(entry, 'jersey') as number)
        : typeof readMetadataLoose(entry, 'number') === 'number'
          ? (readMetadataLoose(entry, 'number') as number)
          : null,
    headshotUrl,
    imageSource,
    profileSource,
    statsSource,
    projectionsSource,
    liveSource: null,
    rookieSource,
    adpSource,
    aiAdpSource,
    height: readMetadataLoose(entry, 'height') != null ? String(readMetadataLoose(entry, 'height')) : null,
    weight: readMetadataLoose(entry, 'weight') != null ? String(readMetadataLoose(entry, 'weight')) : null,
    birthDateRaw:
      readMetadataLoose(entry, 'birthDateRaw') != null
        ? String(readMetadataLoose(entry, 'birthDateRaw'))
        : readMetadataLoose(entry, 'dob') != null
          ? String(readMetadataLoose(entry, 'dob'))
          : null,
    age: meta.age ?? null,
    college: meta.collegeOrPipeline ?? entry.collegeOrPipeline ?? null,
    collegeClassRaw: classRaw,
    collegeClass,
    collegeClassBucket: getCollegeClassBucket(classRaw),
    isFreshman: collegeClass === 'freshman',
    isUnderclassman: collegeClass === 'freshman' || collegeClass === 'sophomore',
    isDraftEligible: isDraftEligibleCollegeClass(classRaw),
    draftYear: typeof readMetadataLoose(entry, 'draftYear') === 'number'
      ? (readMetadataLoose(entry, 'draftYear') as number)
      : entry.draftEligibleYear ?? null,
    yearsExperience: sport === 'NFL' ? entry.yearsExp ?? null : isNcaf ? null : entry.yearsExp ?? null,
    yearsExpSource: meta.rookieYearsExpSource ?? null,
    adp: entry.adp ?? spr?.adp ?? null,
    aiAdp: entry.aiAdp ?? null,
    aiAdpSampleSize: entry.aiAdpSampleSize ?? null,
    projectedPoints: display.stats.fantasyPointsPerGame ?? null,
    fantasyPointsPerGame: display.stats.fantasyPointsPerGame ?? null,
    normalizedStats: mergedStats,
    normalizedProjections: mergedProj,
    liveStats: null,
    rawStatsReference: spr?.stats ?? null,
    isDrafted: null,
    isOnRoster: null,
    isOnWaivers: null,
    isFreeAgent: null,
    isLocked: null,
    injuryStatus: meta.injuryStatus ?? entry.injuryStatus ?? null,
    nflRookie,
    soccerPositionGroup: soccerGrp,
    experience,
    lowConfidence,
  }
}

export type BuildUnifiedPlayerOptions = {
  augment?: UnifiedPlayerAugment
}

export function buildUnifiedPlayerProductView(
  entry: NormalizedDraftEntry,
  options?: BuildUnifiedPlayerOptions,
): UnifiedPlayerProductView {
  return {
    ...entry,
    unified: buildUnifiedMeta(entry, options?.augment),
  }
}
