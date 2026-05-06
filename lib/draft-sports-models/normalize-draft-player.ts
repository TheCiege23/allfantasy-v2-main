/**
 * Normalize raw provider/API player data into internal draft models.
 * Sport-aware; supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { DraftSport } from './types'
import type {
  PlayerDisplayModel,
  PlayerAssetModel,
  PlayerDraftMetadataModel,
  PlayerStatSnapshotModel,
  TeamDisplayModel,
  NormalizedDraftEntry,
  NflRookieYearsExpProvenance,
} from './types'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { resolvePlayerAssets, buildTeamDisplayModel, looksLikeSleeperExternalId } from './player-asset-resolver'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type RawDraftPlayerLike = {
  name?: string | null
  playerName?: string | null
  full_name?: string | null
  position?: string | null
  pos?: string | null
  secondaryPositions?: string[] | null
  positionEligibility?: string[] | null
  eligiblePositions?: string[] | null
  team?: string | null
  teamAbbr?: string | null
  playerId?: string | null
  sleeperId?: string | null
  id?: string | null
  adp?: number | null
  bye?: number | null
  byeWeek?: number | null
  injuryStatus?: string | null
  status?: string | null
  college?: string | null
  collegeOrPipeline?: string | null
  isDevy?: boolean
  school?: string | null
  age?: number | null
  classYearLabel?: string | null
  draftGrade?: string | null
  projectedLandingSpot?: string | null
  draftEligibleYear?: number | null
  graduatedToNFL?: boolean
  /** C2C: 'college' | 'pro' */
  poolType?: 'college' | 'pro'
  /** Pre-resolved image URL from TheSportsDB/DB ingestion (used for NCAAF, Soccer, etc.) */
  imageUrl?: string | null
  fantasyPointsPerGame?: number | null
  lifetimeValue?: number | null
  rollingInsightsSupplemental?: {
    fantasyPointsPerGame?: number | null
    gamesPlayed?: number | null
    season?: string | null
  } | null
  /** NFL draft pool: projection + split stats for grid UI (from `/draft/pool`). */
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
  /** D.7 — NFL years of pro experience (Sleeper `years_exp`). 0 = rookie. */
  yearsExp?: number | null
  /** D.7 — explicit rookie marker (e.g. devy promoted to NFL). Falsy when unknown. */
  isRookie?: boolean | null
  /** NFL: pool resolver provenance for Sleeper/import-backed yearsExp (diagnostics). */
  rookieYearsExpSource?: NflRookieYearsExpProvenance | null
  /** Block B.2-C — rookie inference inputs surfaced from the resolver for
   * non-NFL sports. Carried through normalization so the client predicate
   * can branch per sport without reaching into display.metadata. */
  draftYear?: number | string | null
  rookieYear?: number | string | null
  debutYear?: number | string | null
  firstSeasonYear?: number | string | null
  classYear?: string | null
  [key: string]: unknown
}

/**
 * Normalize one raw player into NormalizedDraftEntry with PlayerDisplayModel.
 */
export function normalizeDraftPlayer(
  raw: RawDraftPlayerLike,
  sport: DraftSport | string
): NormalizedDraftEntry {
  const sportNorm = normalizeToSupportedSport(sport) as DraftSport
  const name = String(raw.name ?? raw.playerName ?? raw.full_name ?? '').trim()
  const position = String(raw.position ?? raw.pos ?? '').trim()
  const teamAbbr = raw.team ?? raw.teamAbbr ?? null
  const teamStr = teamAbbr != null ? String(teamAbbr).trim() : null
  const playerId =
    raw.playerId ?? raw.sleeperId ?? raw.id ?? (name ? `name:${name}:${position}:${teamStr ?? ''}` : '')
  const adp = raw.adp != null ? Number(raw.adp) : null
  const byeWeek = raw.byeWeek ?? raw.bye ?? null
  const bye = byeWeek != null ? Number(byeWeek) : null
  const injuryStatus = raw.injuryStatus ?? raw.status ?? null
  const collegeOrPipeline = raw.collegeOrPipeline ?? raw.college ?? raw.school ?? null
  const isDevy = Boolean(raw.isDevy)
  const school = raw.school ?? (isDevy ? collegeOrPipeline : null)
  const draftEligibleYear = raw.draftEligibleYear != null ? Number(raw.draftEligibleYear) : null
  const graduatedToNFL = Boolean(raw.graduatedToNFL)
  const secondaryPositions = Array.isArray(raw.secondaryPositions)
    ? raw.secondaryPositions.map((p) => String(p).trim()).filter(Boolean)
    : []
  const explicitEligibility = Array.isArray(raw.positionEligibility)
    ? raw.positionEligibility
    : Array.isArray(raw.eligiblePositions)
      ? raw.eligiblePositions
      : []
  const positionEligibility = Array.from(
    new Set(
      [position, ...secondaryPositions, ...explicitEligibility]
        .map((p) => String(p ?? '').trim().toUpperCase())
        .filter(Boolean)
    )
  )

  const sleeperForCdn =
    raw.sleeperId != null && String(raw.sleeperId).trim() !== ''
      ? String(raw.sleeperId).trim()
      : looksLikeSleeperExternalId(raw.playerId ?? null)
        ? String(raw.playerId).trim()
        : looksLikeSleeperExternalId(raw.id ?? null)
          ? String(raw.id).trim()
          : null

  const assets = resolvePlayerAssets(playerId || null, teamStr, sportNorm, {
    dbImageUrl: raw.imageUrl ?? null,
    sleeperExternalId: sleeperForCdn,
  })
  const team = buildTeamDisplayModel(teamStr, sportNorm)

  const ageMeta = raw.age != null && Number.isFinite(Number(raw.age)) ? Number(raw.age) : null

  const metadata: PlayerDraftMetadataModel = {
    position: position || '—',
    secondaryPositions: secondaryPositions.length > 0 ? secondaryPositions : undefined,
    positionEligibility: positionEligibility.length > 0 ? positionEligibility : undefined,
    teamAbbreviation: teamStr,
    teamAffiliation: teamStr ?? (school != null ? String(school).trim() : null),
    byeWeek: bye,
    age: ageMeta,
    injuryStatus: injuryStatus != null ? String(injuryStatus).trim() : null,
    collegeOrPipeline: collegeOrPipeline != null ? String(collegeOrPipeline).trim() : (school != null ? String(school).trim() : null),
    classYearLabel: raw.classYearLabel != null ? String(raw.classYearLabel).trim() : null,
    draftGrade: raw.draftGrade != null ? String(raw.draftGrade).trim() : null,
    projectedLandingSpot: raw.projectedLandingSpot != null ? String(raw.projectedLandingSpot).trim() : null,
    sport: sportNorm,
    rookieYearsExpSource:
      raw.rookieYearsExpSource === 'explicit_imported' ||
      raw.rookieYearsExpSource === 'sleeper_live' ||
      raw.rookieYearsExpSource === 'sleeper_db_cache' ||
      raw.rookieYearsExpSource === 'analytics_veteran_inferred'
        ? raw.rookieYearsExpSource
        : undefined,
  }

  const fppg =
    raw.fantasyPointsPerGame != null && Number.isFinite(Number(raw.fantasyPointsPerGame))
      ? Number(raw.fantasyPointsPerGame)
      : null
  const ltv =
    raw.lifetimeValue != null && Number.isFinite(Number(raw.lifetimeValue)) ? Number(raw.lifetimeValue) : null

  const stats: PlayerStatSnapshotModel = {
    rollingInsightsSupplemental: raw.rollingInsightsSupplemental ?? undefined,
    primaryStatLabel: adp != null ? 'ADP' : fppg != null ? 'PPG' : ltv != null ? 'Val' : null,
    primaryStatValue: adp ?? fppg ?? ltv ?? null,
    secondaryStatLabel:
      adp != null && fppg != null
        ? 'PPG'
        : adp != null && bye != null && bye > 0
          ? 'Bye'
          : adp != null && ltv != null && fppg == null
            ? 'Val'
            : fppg != null && bye != null && bye > 0
              ? 'Bye'
              : null,
    secondaryStatValue:
      adp != null && fppg != null
        ? fppg
        : adp != null && bye != null && bye > 0
          ? bye
          : adp != null && ltv != null && fppg == null
            ? ltv
            : fppg != null && bye != null && bye > 0
              ? bye
              : null,
    adp: adp ?? null,
    byeWeek: bye ?? null,
    fantasyPointsPerGame: fppg,
    lifetimeValue: ltv,
  }

  const display: PlayerDisplayModel = {
    playerId: String(playerId),
    displayName: name || '—',
    sport: sportNorm,
    assets,
    team,
    stats,
    metadata,
  }

  return {
    display,
    name: name || '—',
    position: metadata.position,
    team: teamStr,
    adp: adp ?? undefined,
    byeWeek: bye ?? undefined,
    playerId: playerId ? String(playerId) : undefined,
    injuryStatus: metadata.injuryStatus ?? undefined,
    collegeOrPipeline: metadata.collegeOrPipeline ?? undefined,
    isDevy: isDevy || undefined,
    school: school != null ? String(school).trim() : undefined,
    classYearLabel: raw.classYearLabel != null ? String(raw.classYearLabel).trim() : undefined,
    draftGrade: raw.draftGrade != null ? String(raw.draftGrade).trim() : undefined,
    projectedLandingSpot: raw.projectedLandingSpot != null ? String(raw.projectedLandingSpot).trim() : undefined,
    draftEligibleYear: draftEligibleYear ?? undefined,
    graduatedToNFL: graduatedToNFL || undefined,
    poolType: raw.poolType ?? (isDevy ? 'college' : undefined),
    nflDraftProjectionSplits: raw.nflDraftProjectionSplits ?? undefined,
    yearsExp:
      raw.yearsExp != null && Number.isFinite(Number(raw.yearsExp)) ? Number(raw.yearsExp) : null,
    isRookie:
      raw.isRookie === true ||
      (raw.yearsExp != null && Number.isFinite(Number(raw.yearsExp)) && Number(raw.yearsExp) === 0)
        ? true
        : undefined,
    // Block B.2-C — surface rookie inference inputs at the top level of the
    // normalized entry so isRookieEligibleForFilter can branch per-sport without
    // needing display.metadata. age is intentionally lifted to the top level
    // here too (display.metadata.age remains for tab-header chips).
    age: raw.age ?? undefined,
    draftYear: raw.draftYear ?? undefined,
    rookieYear: raw.rookieYear ?? undefined,
    debutYear: raw.debutYear ?? undefined,
    firstSeasonYear: raw.firstSeasonYear ?? undefined,
    classYear: raw.classYear != null ? String(raw.classYear).trim() : undefined,
  }
}

/**
 * Normalize a list of raw players into NormalizedDraftEntry[].
 */
export function normalizeDraftPlayerList(
  rawList: RawDraftPlayerLike[],
  sport: DraftSport | string
): NormalizedDraftEntry[] {
  const sportNorm = normalizeToSupportedSport(sport) as DraftSport
  return (rawList || []).map((raw) => normalizeDraftPlayer(raw, sportNorm))
}
