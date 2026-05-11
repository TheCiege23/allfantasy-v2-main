/**
 * Single server source for normalized draft pool rows (same enrichment as GET /draft/pool).
 * Use from API route, DraftWorker, autopick fallback, and tests.
 */

import { prisma } from '@/lib/prisma'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { normalizePlayerList, type NormalizedDraftEntry } from '@/lib/draft-asset-pipeline'
import { isDevyLeague } from '@/lib/devy'
import { getPromotedProPlayerIdsExcludedFromRookiePool } from '@/lib/devy'
import { isC2CLeague, getC2CPromotedProPlayerIdsExcludedFromRookiePool } from '@/lib/merged-devy-c2c'
import type { LeagueSport } from '@prisma/client'
import {
  getEffectiveLeagueRosterTemplate,
  starterEligiblePlayerPositionsFromTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import {
  draftPoolRowMatchesEligiblePositions,
} from '@/lib/draft-room/draft-pool-eligible-positions'
import {
  defaultNflPlayerStatsSeason,
  loadRollingInsightsSeasonByDraftPoolKey,
  loadRollingInsightsStatsDetailByPlayerIds,
  loadPlayerSeasonStatsFallback,
  resolveNflDraftPoolAnalytics,
  type RollingInsightsSeasonSlice,
  type RollingInsightsStatsDetailRow,
} from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'
import {
  buildNflDraftProjectionSplits,
  emptyNflDraftProjectionSplits,
  type NflDraftProjectionSplits,
} from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import {
  loadNflRookieLookup,
  lookupYearsExp,
  type NflRookieFetchSource,
  type NflRookieLookup,
} from '@/lib/draft-room/nflRookieLookup'
import {
  canonicalName,
  canonicalPosition,
  canonicalTeam,
  isFreeAgentTeam,
  strictIdentityKey,
  strictIdentityKeyWithTeam,
} from '@/lib/draft-room/player-canonical-identity'
import { normalizeDraftPoolInjuryStatus } from '@/lib/draft-room/injury-status-normalization'
import { compareDraftEntriesByStableRank, resolvePreferredAdp } from '@/lib/draft-room/adp-ordering'
import { dbFirstMode } from '@/lib/db-first-mode'
import { applyPositionAwareProjectionFallbacks, type ProjectionFallbackDiagnostics } from '@/lib/draft-room/position-aware-projection-fallback'
import {
  loadSportsPlayerRecordMapsForDraftPool,
  lookupSportsPlayerRecordAugmentDetailed,
} from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { logPlayerMismatchEventVoid } from '@/lib/player-identity/playerMismatchLogger'
import { isFreeAgentTeam as isNormalizedFreeAgentTeam } from '@/lib/player-identity/playerIdentityResolution'

const DEFAULT_LIMIT = 300
const DEVY_POOL_LIMIT = 200
const IDP_POOL_LIMIT = 200
const IDP_POSITIONS = ['DE', 'DT', 'LB', 'CB', 'S']
const ADP_IMPORT_SOURCES_EXCLUDED = ['ai_adp', 'allfantasy_app', 'custom', 'consensus']

export type PoolType =
  | 'startup_vet'
  | 'rookie'
  | 'devy'
  | 'startup_pro'
  | 'startup_college'
  | 'startup_merged'
  | 'college'
  | 'merged_rookie_college'

export type DraftPoolRawRow = {
  name?: string
  playerName?: string
  full_name?: string
  position?: string
  pos?: string
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
  secondaryPositions?: string[]
  college?: string | null
  isDevy?: boolean
  school?: string | null
  classYearLabel?: string | null
  draftGrade?: string | null
  projectedLandingSpot?: string | null
  draftEligibleYear?: number | null
  graduatedToNFL?: boolean
  poolType?: 'college' | 'pro'
  imageUrl?: string | null
  age?: number | null
  fantasyPointsPerGame?: number | null
  lifetimeValue?: number | null
  nflDraftProjectionSplits?: NflDraftProjectionSplits
  /** D.7 — Sleeper years_exp; 0 = rookie. Only attached for NFL pools. */
  yearsExp?: number | null
  isRookie?: boolean | null
  /** Block B.2-A — rookie inference metadata for non-NFL sports.
   * Sport propagated so the predicate can branch on per-sport rules.
   * Year fields normalized to camelCase here; pool rows may surface either
   * snake_case or camelCase from upstream sources. */
  sport?: string
  draftYear?: number | string | null
  rookieYear?: number | string | null
  debutYear?: number | string | null
  firstSeasonYear?: number | string | null
  classYear?: string | null
  /** Internal: preserve source IDs before any backfill or reconciliation. */
  sourcePlayerId?: string | null
  sourceSleeperId?: string | null
}

export type GetResolvedDraftPoolOptions = {
  limit?: number
  poolType?: PoolType | null
  /** Normalized lowercase trimmed names — excludes rows matching drafted picks by name. */
  excludeDraftedNames?: ReadonlySet<string>
  excludeDraftedPlayerIds?: ReadonlySet<string>
  /**
   * When provided, skips getEffectiveLeagueRosterTemplate (caller already loaded for cache keys).
   */
  effectiveLeagueTemplate?: Awaited<ReturnType<typeof getEffectiveLeagueRosterTemplate>>
}

export type GetResolvedDraftPoolResult = {
  entries: NormalizedDraftEntry[]
  sport: LeagueSport
  count: number
  rosterConfigurationIncomplete: boolean
  projectionDiagnostics?: ProjectionFallbackDiagnostics
  poolType?: PoolType
  devyConfig?: { enabled: true; devyRounds: number[] }
  c2cConfig?: { enabled: true; collegeRounds: number[] }
  isIdp?: boolean
}

type SportPoolRow = {
  full_name: string
  position: string
  team_abbreviation: string | null
  external_source_id: string | null
  injury_status: string | null
  secondary_positions?: string[]
  image_url?: string | null
  status?: string | null
  player_id?: string | null
  age?: number | null
  /** Block B.2-A — rookie inference inputs surfaced from SportsPlayer when
   * available. Both snake_case (DB) and camelCase (already-normalized) are
   * accepted so the resolver can read either shape without a refactor. */
  draft_year?: number | string | null
  draftYear?: number | string | null
  rookie_year?: number | string | null
  rookieYear?: number | string | null
  debut_year?: number | string | null
  debutYear?: number | string | null
  first_season_year?: number | string | null
  firstSeasonYear?: number | string | null
  class_year?: string | null
  classYear?: string | null
  class_year_label?: string | null
  classYearLabel?: string | null
}

type InjuryLookupRow = {
  playerId: string
  playerName: string
  team: string
  status: string
  bodyPart: string | null
  notes: string | null
  gameStatus: string | null
  reportDate: Date
  week: number | null
}

function injuryNameTeamKey(name: string | null | undefined, team: string | null | undefined): string {
  return `${canonicalName(name)}|${canonicalTeam(team)}`
}

function injuryNameKey(name: string | null | undefined): string {
  return canonicalName(name)
}

function inferCurrentNflWeek(date: Date = new Date()): number {
  const day = date.getUTCDate()
  return Math.max(1, Math.min(18, Math.ceil(day / 7)))
}

/**
 * Identity key for player name dedupe.
 *
 * Phase 2 (Player Pool Identity Cleanup): delegates to the shared
 * `canonicalName` helper which strips apostrophes, dots, suffixes (Jr/Sr/III)
 * and collapses single-letter token pairs. The previous body (`.trim().toLowerCase()`)
 * left Ja'Marr/Jamarr, A.J./AJ, MHJ/MH-Jr as different keys — every SportsPlayer
 * cache lookup MISSED, which is why the audit reported `missing sleeperId: 1963/1963`.
 *
 * Both the cache build and the lookup go through this function, so equality
 * is preserved automatically across all 20+ call sites.
 */
export function normalizeDraftPoolNameForDedupe(name: string): string {
  return canonicalName(name)
}

function normalizeKeyPart(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Map-build only: TheSportsDB stores full English position names ("Wide Receiver",
 * "Running Back") while every other source and all pool rows use abbreviations
 * ("WR", "RB"). Without this normalization, the sportsPlayer maps get keyed on
 * "wide receiver" while pool lookups use "wr" — they never match and the
 * TheSportsDB high-quality cutout images are silently skipped.
 *
 * Called only when building the sportsPlayer maps; the lookup side uses the
 * pool row's native (already-abbreviated) position, so no lookup-side changes
 * are needed.
 */
const POSITION_FULL_TO_ABBREV: Record<string, string> = {
  'wide receiver': 'wr',
  'running back': 'rb',
  'quarterback': 'qb',
  'tight end': 'te',
  'kicker': 'k',
  'punter': 'p',
  'fullback': 'fb',
  'full-back': 'fb',
  'linebacker': 'lb',
  'outside linebacker': 'olb',
  'inside linebacker': 'ilb',
  'middle linebacker': 'mlb',
  'cornerback': 'cb',
  'safety': 's',
  'defensive end': 'de',
  'defensive tackle': 'dt',
  'defensive back': 'db',
  'defensive lineman': 'dl',
  'offensive tackle': 'ot',
  'offensive guard': 'og',
  'offensive lineman': 'ol',
  'guard': 'g',
  'center': 'c',
  'long snapper': 'ls',
  'nose tackle': 'nt',
  'right tackle': 'rt',
}

function normalizePositionForMapKey(pos: string | null | undefined): string {
  const lower = String(pos ?? '').trim().toLowerCase()
  return POSITION_FULL_TO_ABBREV[lower] ?? lower
}

const LOOSE_NAME_ALIASES: Record<string, string> = {
  cam: 'cameron',
}

/**
 * Phase 2 — delegated to shared `canonicalName`. The previous body turned
 * apostrophes into spaces and special-cased only `de von → devon`, missing
 * Ja'Marr / D'Andre / O'Donnell etc. `canonicalName` strips apostrophes outright
 * and applies the same rule to every name. The `LOOSE_NAME_ALIASES` map (`cam → cameron`)
 * is no longer applied; if a Cam vs. Cameron alias is needed it should be a
 * documented player-mapping table, not a generic substitution.
 */
function normalizeLooseName(name: string | null | undefined): string {
  return canonicalName(name)
}

function loosePlayerKey(name: string, position: string): string {
  return `${normalizeLooseName(name)}|${normalizeKeyPart(position)}`
}

function loosePlayerTeamKey(name: string, position: string, team?: string | null): string {
  return `${normalizeLooseName(name)}|${normalizeKeyPart(position)}|${normalizeKeyPart(team)}`
}

function poolMergeCap(limit: number): number {
  // Must exceed ADP seed + essentially all SportsPlayer rows for NFL; otherwise
  // merge stops early and deep roster + K/DST never surface in the draft room.
  return Math.min(25_000, Math.max(limit * 14, 6000))
}

function looksLikeSleeperNumericId(value: string | null | undefined): boolean {
  const t = String(value ?? '').trim()
  return /^\d{3,}$/.test(t)
}

function adpLookupKey(name: string, position: string, team?: string | null): string {
  return `${normalizeDraftPoolNameForDedupe(name)}|${normalizeKeyPart(position)}|${normalizeKeyPart(team)}`
}

function adpLookupKeyLoose(name: string, position: string): string {
  return `${normalizeDraftPoolNameForDedupe(name)}|${normalizeKeyPart(position)}`
}

type AveragedAdpRow = {
  name: string
  position: string
  team: string | null
  adp: number
}

async function loadLatestAveragedAdpRowsFromDb(
  sport: LeagueSport,
  format: 'redraft' | 'dynasty',
): Promise<AveragedAdpRow[]> {
  const findLatest = () =>
    prisma.adpDataRecord.findFirst({
      where: {
        sport,
        format,
        source: { notIn: ADP_IMPORT_SOURCES_EXCLUDED },
      },
      orderBy: [{ season: 'desc' }, { week: 'desc' }, { createdAt: 'desc' }],
      select: { season: true, week: true },
    })

  let latest = await findLatest()
  if (!latest) {
    if (
      !dbFirstMode.useDbCacheOnly &&
      !dbFirstMode.disableLiveApiOnPageLoad &&
      !dbFirstMode.disableAdpLiveMergeOnPageLoad
    ) {
      try {
        const { runAdpImporter } = await import('@/lib/workers/adp-importer')
        await runAdpImporter({ sports: [sport] })
        latest = await findLatest()
      } catch {
        // Keep degraded path; caller will continue without ADP if import fails.
      }
    }
  }
  if (!latest) return []

  const rows = await prisma.adpDataRecord.findMany({
    where: {
      sport,
      format,
      season: latest.season,
      week: latest.week,
      source: { notIn: ADP_IMPORT_SOURCES_EXCLUDED },
    },
    select: {
      playerName: true,
      position: true,
      team: true,
      source: true,
      adp: true,
    },
    take: 30000,
  })

  const perPlayerSource = new Map<string, { name: string; position: string; team: string | null; perSource: Map<string, number[]> }>()
  for (const row of rows) {
    const name = String(row.playerName ?? '').trim()
    const position = String(row.position ?? '').trim().toUpperCase()
    if (!name || !position || !Number.isFinite(Number(row.adp))) continue
    const team = row.team ? String(row.team).trim().toUpperCase() : null
    const key = adpLookupKey(name, position, team)
    if (!perPlayerSource.has(key)) {
      perPlayerSource.set(key, {
        name,
        position,
        team,
        perSource: new Map<string, number[]>(),
      })
    }
    const bucket = perPlayerSource.get(key)!
    const sourceKey = String(row.source ?? '').trim().toLowerCase() || 'unknown'
    const sourceValues = bucket.perSource.get(sourceKey) ?? []
    sourceValues.push(Number(row.adp))
    bucket.perSource.set(sourceKey, sourceValues)
  }

  const out: AveragedAdpRow[] = []
  for (const item of perPlayerSource.values()) {
    const sourceMeans: number[] = []
    for (const values of item.perSource.values()) {
      if (!values.length) continue
      const sum = values.reduce((acc, v) => acc + v, 0)
      sourceMeans.push(sum / values.length)
    }
    if (!sourceMeans.length) continue
    const avg = sourceMeans.reduce((acc, v) => acc + v, 0) / sourceMeans.length
    out.push({
      name: item.name,
      position: item.position,
      team: item.team,
      adp: Number(avg.toFixed(2)),
    })
  }

  out.sort((a, b) => a.adp - b.adp)
  return out
}

function enrichRawRowFromDbPool(existing: DraftPoolRawRow, p: SportPoolRow): void {
  const extId = p.external_source_id ?? null
  const legacyPlayerId = p.player_id ?? null
  existing.playerId ??= extId ?? legacyPlayerId ?? undefined
  existing.sleeperId ??= extId ?? undefined
  existing.id ??= extId ?? legacyPlayerId ?? undefined
  existing.imageUrl ??= p.image_url ?? undefined
  existing.team ??= p.team_abbreviation ?? undefined
  existing.injuryStatus ??= p.injury_status ?? undefined
  existing.status ??= p.status ?? undefined
  existing.age ??= p.age ?? undefined
  if (
    (!existing.secondaryPositions || existing.secondaryPositions.length === 0) &&
    Array.isArray(p.secondary_positions) &&
    p.secondary_positions.length > 0
  ) {
    existing.secondaryPositions = [...p.secondary_positions]
  }
}

function mergeDbPoolIntoRawList(
  rawList: DraftPoolRawRow[],
  poolRows: SportPoolRow[],
  mergeCap: number,
  useMixedPoolTypeMarkers: boolean,
  seenNames: Set<string>,
): void {
  for (const p of poolRows) {
    const norm = normalizeDraftPoolNameForDedupe(p.full_name ?? '')
    const looseNorm = normalizeLooseName(p.full_name ?? '')
    const poolPos = normalizeKeyPart(p.position ?? '')
    const poolTeam = normalizeKeyPart(p.team_abbreviation ?? '')
    if (!norm) continue

    const existingIdx = rawList.findIndex(
      (r) => {
        const rowName = r.name ?? r.playerName ?? r.full_name ?? ''
        const rowNorm = normalizeDraftPoolNameForDedupe(rowName)
        const rowLoose = normalizeLooseName(rowName)
        const rowPos = normalizeKeyPart(r.position ?? r.pos ?? '')
        const rowTeam = normalizeKeyPart(r.team ?? r.teamAbbr ?? '')

        const posMatch = !poolPos || !rowPos || poolPos === rowPos
        const teamMatch = !poolTeam || !rowTeam || poolTeam === rowTeam
        if (!posMatch || !teamMatch) return false

        return rowNorm === norm || (looseNorm && rowLoose === looseNorm)
      },
    )
    if (existingIdx >= 0) {
      enrichRawRowFromDbPool(rawList[existingIdx], p)
      seenNames.add(norm)
      continue
    }

    if (rawList.length >= mergeCap) continue
    if (seenNames.has(norm)) continue
    seenNames.add(norm)
    rawList.push({
      name: p.full_name,
      position: p.position ?? '—',
      team: p.team_abbreviation ?? null,
      playerId: p.external_source_id ?? p.player_id ?? null,
      adp: null,
      bye: null,
      injuryStatus: p.injury_status ?? null,
      status: p.status ?? null,
      secondaryPositions: Array.isArray(p.secondary_positions) ? p.secondary_positions : undefined,
      imageUrl: p.image_url ?? null,
      age: p.age ?? null,
      ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
    })
  }
}

function hasHttpHeadshot(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim())
}

function hasVeteranEvidenceFromAnalytics(input: {
  analytics: {
    fantasyPointsPerGame: number | null
    lifetimeValue: number | null
  } | null | undefined
  riSlice: RollingInsightsSeasonSlice | null | undefined
  resolvedSupplemental:
    | {
        fantasyPointsPerGame?: number | null
        gamesPlayed?: number | null
      }
    | null
    | undefined
}): boolean {
  const gamesFromSupplemental = input.resolvedSupplemental?.gamesPlayed
  if (typeof gamesFromSupplemental === 'number' && Number.isFinite(gamesFromSupplemental) && gamesFromSupplemental > 0) {
    return true
  }

  const gamesFromRi = input.riSlice?.gamesPlayed
  if (typeof gamesFromRi === 'number' && Number.isFinite(gamesFromRi) && gamesFromRi > 0) {
    return true
  }

  const fantasySeason = input.riSlice?.fantasyPointsSeason
  if (typeof fantasySeason === 'number' && Number.isFinite(fantasySeason) && fantasySeason > 0) {
    return true
  }

  const fppg = input.analytics?.fantasyPointsPerGame
  if (typeof fppg === 'number' && Number.isFinite(fppg) && fppg > 0) {
    return true
  }

  const ltv = input.analytics?.lifetimeValue
  if (typeof ltv === 'number' && Number.isFinite(ltv) && ltv > 0) {
    return true
  }

  return false
}

function hasJrSuffix(name: string | null | undefined): boolean {
  return /(^|\s)jr$/.test(canonicalName(name))
}

function jrAliasBaseKey(name: string, position: string, team: string | null | undefined): string {
  const n = canonicalName(name).replace(/(^|\s)jr$/, '').trim()
  return `${n}|${canonicalPosition(position)}|${canonicalTeam(team)}`
}

/**
 * Phase 2 — strict identity dedupe.
 *
 * Primary key is `strictIdentityKey(name, position)` (canonicalName + canonicalPos),
 * deliberately team-AGNOSTIC. The audit revealed 33 duplicate identity groups
 * caused by FFC ADP keeping a stale team (e.g. "Russell Wilson QB/FA") while the
 * DB pool has the current team ("Russell Wilson QB/NYG"). Including team in the
 * dedupe key kept both rows; collapsing on (name, position) merges them.
 *
 * Best-row scoring (per Phase 2 spec):
 *   +200  has a real http(s) headshot URL (not data:, not team logo)
 *   +120  has a non-FA, non-blank team
 *   +120  has a valid sleeperId
 *   +60   has a valid ADP
 *   +20   ADP is in the realistic range (≤ 400)
 *   +5    longer display name (tiebreaker — prefers "A.J. Brown" over "AJ Brown")
 */
function dedupeEnrichedRawRows(rows: DraftPoolRawRow[]): DraftPoolRawRow[] {
  const bestByKey = new Map<string, DraftPoolRawRow>()
  for (const row of rows) {
    const name = row.name ?? row.playerName ?? row.full_name ?? ''
    const pos = row.position ?? row.pos ?? ''
    const key = strictIdentityKey(name, pos)
    if (!key || key === '|') continue

    const current = bestByKey.get(key)
    if (!current) {
      bestByKey.set(key, row)
      continue
    }

    if (scoreDraftPoolRow(row) > scoreDraftPoolRow(current)) {
      bestByKey.set(key, row)
    }
  }

  return [...bestByKey.values()]
}

function scoreDraftPoolRow(row: DraftPoolRawRow): number {
  const name = row.name ?? row.playerName ?? row.full_name ?? ''
  const team = row.team ?? row.teamAbbr ?? null
  const sleeperId = (row as { sleeperId?: string | null }).sleeperId ?? null
  const adp = typeof row.adp === 'number' && Number.isFinite(row.adp) ? row.adp : null

  let score = 0
  if (hasHttpHeadshot((row as DraftPoolRawRow).imageUrl)) score += 200
  if (!isFreeAgentTeam(team)) score += 120
  if (sleeperId && String(sleeperId).trim().length >= 3) score += 120
  if (adp != null) score += 60
  if (adp != null && adp <= 400) score += 20
  score += Math.min(String(name).length, 40) // small bias toward fuller display names
  return score
}

/**
 * Enforce single-owner semantics for external IDs inside one pool snapshot.
 * If one playerId/sleeperId resolves to multiple canonical identities, keep the
 * id only on the highest-confidence row and clear it on the others.
 */
function resolveConflictingExternalIds(rows: DraftPoolRawRow[]): DraftPoolRawRow[] {
  const byExternal = new Map<string, DraftPoolRawRow[]>()
  const keyFor = (r: DraftPoolRawRow) => {
    const id = String(r.playerId ?? r.sleeperId ?? '').trim()
    return looksLikeSleeperNumericId(id) ? id : null
  }

  for (const row of rows) {
    const key = keyFor(row)
    if (!key) continue
    const list = byExternal.get(key) ?? []
    list.push(row)
    byExternal.set(key, list)
  }

  const chooseBest = (id: string, candidates: DraftPoolRawRow[]): DraftPoolRawRow => {
    const score = (r: DraftPoolRawRow): number => {
      let s = scoreDraftPoolRow(r)
      const sourcePlayer = String(r.sourcePlayerId ?? '').trim()
      const sourceSleeper = String(r.sourceSleeperId ?? '').trim()
      if (sourcePlayer === id) s += 220
      if (sourceSleeper === id) s += 220
      if (r.yearsExp != null) s += 15
      return s
    }
    return [...candidates].sort((a, b) => score(b) - score(a))[0]!
  }

  for (const [id, group] of byExternal.entries()) {
    const identityCount = new Set(group.map((r) => strictIdentityKey(r.name ?? r.playerName ?? r.full_name ?? '', r.position ?? r.pos ?? ''))).size
    if (identityCount <= 1) continue
    const winner = chooseBest(id, group)
    for (const row of group) {
      if (row === winner) continue
      row.playerId = row.sourcePlayerId ?? null
      row.sleeperId = row.sourceSleeperId ?? null
      if (String(row.playerId ?? '').trim() === id) row.playerId = null
      if (String(row.sleeperId ?? '').trim() === id) row.sleeperId = null
      if (String(row.id ?? '').trim() === id) row.id = null
    }
  }

  return rows
}

function filterExcludedDraftEntries(
  entries: NormalizedDraftEntry[],
  excludeDraftedNames?: ReadonlySet<string>,
  excludeDraftedPlayerIds?: ReadonlySet<string>,
): NormalizedDraftEntry[] {
  if (
    (!excludeDraftedNames || excludeDraftedNames.size === 0) &&
    (!excludeDraftedPlayerIds || excludeDraftedPlayerIds.size === 0)
  ) {
    return entries
  }
  return entries.filter((e) => {
    const nk = normalizeDraftPoolNameForDedupe(e.name)
    if (excludeDraftedNames?.size && excludeDraftedNames.has(nk)) return false
    const pid = String(e.display?.playerId ?? e.playerId ?? '').trim()
    if (pid && excludeDraftedPlayerIds?.size && excludeDraftedPlayerIds.has(pid)) return false
    return true
  })
}

/**
 * Phase 3b — perf instrumentation. Set `AF_DRAFT_POOL_PERF=1` (env) or
 * `process.env.AF_DRAFT_POOL_PERF` to log per-step timings to stderr. Off by
 * default so we don't spam in production.
 */
const PERF_LOG = (() => {
  const v = (process.env.AF_DRAFT_POOL_PERF ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
})()
function perfStart(label: string): () => void {
  if (!PERF_LOG) return () => {}
  const t0 = Date.now()
  return () => {
    const ms = Date.now() - t0
    if (ms >= 50 || ms < 0) {
      console.log(`[draft-pool perf] ${label.padEnd(48, ' ')} ${ms}ms`)
    }
  }
}

/**
 * Builds the same normalized draft pool as GET `/api/leagues/[leagueId]/draft/pool`.
 */
export async function getResolvedDraftPoolForLeague(
  leagueId: string,
  options: GetResolvedDraftPoolOptions = {},
): Promise<GetResolvedDraftPoolResult> {
  const _coldBuildStartMs = Date.now()
  const perfTotal = perfStart(`TOTAL leagueId=${leagueId.slice(0, 8)}`)
  const perfTemplate = perfStart('1. effectiveLeagueTemplate')
  const effectiveLeagueTemplate =
    options.effectiveLeagueTemplate ?? (await getEffectiveLeagueRosterTemplate(leagueId))
  perfTemplate()

  if (!effectiveLeagueTemplate.hasPersistedRosterSchema) {
    return {
      entries: [],
      sport: effectiveLeagueTemplate.sport,
      count: 0,
      rosterConfigurationIncomplete: true,
      isIdp: effectiveLeagueTemplate.idpEnabled || undefined,
    }
  }

  const starterEligible = starterEligiblePlayerPositionsFromTemplate(effectiveLeagueTemplate.template)
  const eligiblePositions =
    starterEligible.size > 0
      ? starterEligible
      : effectiveLeagueTemplate.allowedPositions.size > 0
        ? new Set<string>(effectiveLeagueTemplate.allowedPositions)
        : null

  const perfLeagueDraft = perfStart('2. league + draftSession')
  const [league, draftSession] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        sport: true,
        leagueVariant: true,
        settings: true,
        starters: true,
        season: true,
        scoring: true,
        isDynasty: true,
        leagueSize: true,
        leagueSettings: { select: { draftType: true } },
      },
    }),
    prisma.draftSession.findUnique({
      where: { leagueId },
      select: { devyConfig: true, c2cConfig: true, keeperSelections: true, draftType: true },
    }),
  ])
  perfLeagueDraft()
  const sport = (league?.sport as LeagueSport) ?? DEFAULT_SPORT
  const settingsDraftType = String(league?.leagueSettings?.draftType ?? '').toLowerCase()
  const sessionDraftType = draftSession?.draftType ? String(draftSession.draftType).toLowerCase() : ''
  const isAuction = sessionDraftType === 'auction' || (!sessionDraftType && settingsDraftType === 'auction')
  const rawLimit = options.limit ?? DEFAULT_LIMIT
  const limit = Math.min(Math.max(Number(rawLimit) || DEFAULT_LIMIT, 1), 500)
  let poolType = options.poolType ?? null
  const perfDevyC2C = perfStart('3. isDevyLeague + isC2CLeague')
  const isDevyDynasty = await isDevyLeague(leagueId)
  const isC2C = await isC2CLeague(leagueId)
  perfDevyC2C()
  const rawDevyConfig = draftSession?.devyConfig as { enabled?: boolean; devyRounds?: number[] } | null
  const rawC2cConfig = draftSession?.c2cConfig as { enabled?: boolean; collegeRounds?: number[] } | null
  const devyEnabled = Boolean(rawDevyConfig?.enabled)
  const c2cEnabled = Boolean(rawC2cConfig?.enabled) || isC2C
  const liveDraftUsesDevyPools = devyEnabled || c2cEnabled
  if (isDevyDynasty && !isC2C && poolType == null && !liveDraftUsesDevyPools) poolType = 'startup_vet'
  if (isC2C && poolType == null && !liveDraftUsesDevyPools) poolType = 'startup_merged'
  const mergeCollegePool = (devyEnabled || c2cEnabled) && (sport === 'NFL' || sport === 'NBA')
  const strictPoolSeparation = (isDevyDynasty && poolType != null) || (isC2C && poolType != null)
  const useMixedPoolTypeMarkers = mergeCollegePool || c2cEnabled || devyEnabled
  const adpFormat: 'redraft' | 'dynasty' =
    league?.isDynasty || String(league?.leagueVariant ?? '').toLowerCase().includes('dynasty')
      ? 'dynasty'
      : 'redraft'
  const perfAdpRows = perfStart('4. loadLatestAveragedAdpRowsFromDb')
  const averagedAdpRows = await loadLatestAveragedAdpRowsFromDb(sport, adpFormat).catch(
    () => [] as AveragedAdpRow[],
  )
  perfAdpRows()
  const averagedAdpStrict = new Map<string, number>()
  const averagedAdpLoose = new Map<string, number>()
  for (const row of averagedAdpRows) {
    const strictKey = adpLookupKey(row.name, row.position, row.team)
    if (!averagedAdpStrict.has(strictKey)) averagedAdpStrict.set(strictKey, row.adp)
    const looseKey = adpLookupKeyLoose(row.name, row.position)
    if (!averagedAdpLoose.has(looseKey)) averagedAdpLoose.set(looseKey, row.adp)
  }

  /**
   * Block A — multi-sport ADP seed.
   * Build a sport-agnostic raw-list seed from the averaged ADP rows so non-NFL
   * pools (NBA / NHL / MLB / NCAAB / SOCCER) can start from real ADP order
   * instead of falling through to a SportsPlayer-only slice. Caller decides
   * when to apply this seed; NFL keeps its own branch (with IDP + rookie
   * promoted-pro filtering).
   */
  function buildAdpSeedRowsForSport(
    seedSport: string,
    adpRows: AveragedAdpRow[],
    useMixed: boolean,
  ): DraftPoolRawRow[] {
    return adpRows
      .filter((row) => {
        const name = String(row.name ?? '').trim()
        const position = String(row.position ?? '').trim()
        return Boolean(name && position && Number.isFinite(Number(row.adp)))
      })
      .sort((a, b) => Number(a.adp) - Number(b.adp))
      .map<DraftPoolRawRow>((row) => ({
        name: String(row.name).trim(),
        position: String(row.position).trim().toUpperCase(),
        team: row.team ? String(row.team).trim().toUpperCase() : null,
        adp: Number(row.adp),
        bye: null,
        playerId: null,
        injuryStatus: null,
        status: null,
        imageUrl: null,
        sport: seedSport,
        ...(useMixed ? { poolType: 'pro' as const } : {}),
      }))
  }

  type RawRow = DraftPoolRawRow
  let rawList: RawRow[] = []
  const poolFetchLimit =
    sport === 'NFL'
      ? Math.min(50_000, Math.max(limit * 12, 16_000))
      : Math.min(Math.max(limit * 8, 1600), 4500)
  const perfPlayerPool = perfStart(`5. getPlayerPoolForLeague (limit=${poolFetchLimit})`)
  const poolRows: SportPoolRow[] = await getPlayerPoolForLeague(leagueId, sport, {
    limit: poolFetchLimit,
  }).catch(() => [] as SportPoolRow[])
  perfPlayerPool()
  const poolByStrictKey = new Map<string, (typeof poolRows)[number]>()
  const poolByLooseKey = new Map<string, (typeof poolRows)[number]>()
  for (const row of poolRows) {
    const nameKey = normalizeKeyPart(row.full_name)
    const posKey = normalizeKeyPart(row.position)
    const teamKey = normalizeKeyPart(row.team_abbreviation)
    if (!nameKey || !posKey) continue
    const strict = `${nameKey}|${posKey}|${teamKey}`
    const loose = `${nameKey}|${posKey}`
    if (!poolByStrictKey.has(strict)) poolByStrictKey.set(strict, row)
    if (!poolByLooseKey.has(loose)) poolByLooseKey.set(loose, row)
  }

  const injuryByPlayerId = new Map<string, InjuryLookupRow>()
  const injuryByNameTeam = new Map<string, InjuryLookupRow>()
  const injuryByName = new Map<string, InjuryLookupRow>()
  const injuryRecentCutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
  const inferredWeek = sport === 'NFL' ? inferCurrentNflWeek() : null
  try {
    const perfInjuries = perfStart(`5a. injuryReportRecord batch load (${sport})`)
    const injuryRows = await prisma.injuryReportRecord.findMany({
      where: {
        sport,
        ...(typeof inferredWeek === 'number'
          ? {
              OR: [
                { week: inferredWeek },
                { reportDate: { gte: injuryRecentCutoff } },
              ],
            }
          : {
              reportDate: { gte: injuryRecentCutoff },
            }),
      },
      orderBy: [{ reportDate: 'desc' }],
      select: {
        playerId: true,
        playerName: true,
        team: true,
        status: true,
        bodyPart: true,
        notes: true,
        gameStatus: true,
        reportDate: true,
        week: true,
      },
      take: 8000,
    })
    perfInjuries()

    for (const row of injuryRows) {
      const injuryRow: InjuryLookupRow = {
        playerId: String(row.playerId ?? '').trim(),
        playerName: String(row.playerName ?? '').trim(),
        team: String(row.team ?? '').trim(),
        status: String(row.status ?? '').trim(),
        bodyPart: row.bodyPart ?? null,
        notes: row.notes ?? null,
        gameStatus: row.gameStatus ?? null,
        reportDate: row.reportDate,
        week: row.week ?? null,
      }
      if (!injuryRow.status || !injuryRow.playerName) continue

      if (injuryRow.playerId && !injuryByPlayerId.has(injuryRow.playerId)) {
        injuryByPlayerId.set(injuryRow.playerId, injuryRow)
      }

      const nameTeam = injuryNameTeamKey(injuryRow.playerName, injuryRow.team)
      if (nameTeam && !injuryByNameTeam.has(nameTeam)) {
        injuryByNameTeam.set(nameTeam, injuryRow)
      }

      const nameOnly = injuryNameKey(injuryRow.playerName)
      if (nameOnly && !injuryByName.has(nameOnly)) {
        injuryByName.set(nameOnly, injuryRow)
      }
    }
  } catch (error) {
    console.warn('[draft-pool] injuryReportRecord batch lookup failed; falling back to existing injury fields', {
      leagueId,
      sport,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (strictPoolSeparation && (poolType === 'devy' || poolType === 'college' || poolType === 'startup_college')) {
    const devyPlayers = await (prisma as any).devyPlayer
      .findMany({
        where: { devyEligible: true, graduatedToNFL: false },
        take: DEVY_POOL_LIMIT,
        orderBy: { devyAdp: 'asc' },
      })
      .catch(() => [] as any[])
    rawList = devyPlayers.map((p: any) => ({
      name: p.name,
      position: p.position ?? '—',
      team: p.school ?? p.nflTeam ?? null,
      adp: p.devyAdp != null ? Number(p.devyAdp) : null,
      college: p.school ?? null,
      isDevy: true,
      school: p.school ?? null,
      classYearLabel: p.classYearLabel ?? null,
      draftGrade: p.draftGrade ?? null,
      projectedLandingSpot: p.nflTeam ?? null,
      draftEligibleYear: p.draftEligibleYear ?? null,
      graduatedToNFL: false,
      playerId: p.id ?? null,
      ...(isC2C || devyEnabled ? { poolType: 'college' as const } : {}),
    }))
  } else if (isAuction) {
    rawList = []
    const seenAuction = new Set<string>()
    mergeDbPoolIntoRawList(
      rawList,
      poolRows as SportPoolRow[],
      poolMergeCap(limit),
      useMixedPoolTypeMarkers,
      seenAuction,
    )
  } else if (sport === 'NFL') {
    rawList = averagedAdpRows.map((e) => ({
      name: e.name,
      position: e.position,
      team: e.team,
      adp: e.adp,
      bye: null,
      ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
    }))
    if (effectiveLeagueTemplate.idpEnabled) {
      const idpFiltered = poolRows
        .filter((p) => IDP_POSITIONS.includes(p.position?.trim()?.toUpperCase() ?? ''))
        .slice(0, IDP_POOL_LIMIT)
      const seenNames = new Set(rawList.map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')))
      for (const p of idpFiltered) {
        const norm = normalizeDraftPoolNameForDedupe(p.full_name ?? '')
        if (norm && !seenNames.has(norm)) {
          seenNames.add(norm)
          rawList.push({
            name: p.full_name,
            position: p.position ?? '—',
            team: p.team_abbreviation ?? null,
            playerId: p.external_source_id ?? (p as { player_id?: string | null }).player_id ?? null,
            adp: null,
            bye: null,
            ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
          })
        }
      }
    }
    const seenAfterRanked = new Set(
      rawList.map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')),
    )
    mergeDbPoolIntoRawList(
      rawList,
      poolRows as SportPoolRow[],
      poolMergeCap(limit),
      useMixedPoolTypeMarkers,
      seenAfterRanked,
    )
    if (strictPoolSeparation && poolType === 'rookie') {
      const excludedProIds = isC2C
        ? await getC2CPromotedProPlayerIdsExcludedFromRookiePool(leagueId)
        : await getPromotedProPlayerIdsExcludedFromRookiePool(leagueId)
      if (excludedProIds.size > 0) {
        rawList = rawList.filter((r: RawRow) => {
          const id = r.playerId ?? r.id ?? (r as any).sleeperId
          return id == null || !excludedProIds.has(String(id))
        })
      }
    }
  } else {
    /**
     * Block A — non-NFL sports (NBA / NHL / MLB / NCAAB / SOCCER + NCAAF
     * non-redraft / specialty paths). Prefer the averaged-ADP seed when
     * present so the pool starts in real draft order; merge the SportsPlayer
     * pool rows behind it for breadth + image / age / injury / secondary-pos
     * enrichment. Falls back to the previous SportsPlayer-only behavior when
     * no ADP rows exist for this sport (keeps drafts unblocked instead of
     * empty).
     */
    const adpSeedRows = buildAdpSeedRowsForSport(sport, averagedAdpRows, useMixedPoolTypeMarkers)
    if (adpSeedRows.length > 0) {
      rawList = adpSeedRows
      const seenAfterAdpSeed = new Set(
        rawList.map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')),
      )
      mergeDbPoolIntoRawList(
        rawList,
        poolRows as SportPoolRow[],
        poolMergeCap(limit),
        useMixedPoolTypeMarkers,
        seenAfterAdpSeed,
      )
    } else {
      rawList = poolRows.slice(0, limit).map<DraftPoolRawRow>((p) => ({
        name: p.full_name,
        position: p.position,
        team: p.team_abbreviation,
        playerId: p.external_source_id ?? (p as { player_id?: string | null }).player_id ?? null,
        injuryStatus: p.injury_status,
        status: (p as { status?: string | null }).status ?? null,
        imageUrl: (p as { image_url?: string | null }).image_url ?? null,
        age: (p as { age?: number | null }).age ?? null,
        // Block B.2-A — surface rookie inference inputs from SportsPlayer when
        // available. Predicate (rookieFilterPredicate) reads sport + year/age
        // fields to classify rookies for non-NFL sports without changing
        // existing NFL behavior. Both snake_case + camelCase tolerated.
        sport,
        draftYear: p.draft_year ?? p.draftYear ?? null,
        rookieYear: p.rookie_year ?? p.rookieYear ?? null,
        debutYear: p.debut_year ?? p.debutYear ?? null,
        firstSeasonYear: p.first_season_year ?? p.firstSeasonYear ?? null,
        classYear: p.class_year ?? p.classYear ?? null,
        classYearLabel: p.class_year_label ?? p.classYearLabel ?? null,
        ...(useMixedPoolTypeMarkers ? { poolType: 'pro' as const } : {}),
      }))
      const seenNonNfl = new Set(
        rawList.map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')),
      )
      mergeDbPoolIntoRawList(
        rawList,
        poolRows as SportPoolRow[],
        poolMergeCap(limit),
        useMixedPoolTypeMarkers,
        seenNonNfl,
      )
    }
  }

  const proNames = new Set(rawList.map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')))
  const includeCollegeInPool =
    mergeCollegePool && !(strictPoolSeparation && (poolType === 'startup_vet' || poolType === 'startup_pro'))

  if (includeCollegeInPool) {
    const devyPlayers = await (prisma as any).devyPlayer
      .findMany({
        where: { devyEligible: true, graduatedToNFL: false },
        take: DEVY_POOL_LIMIT,
        orderBy: { devyAdp: 'asc' },
      })
      .catch(() => [] as any[])
    for (const p of devyPlayers) {
      const norm = normalizeDraftPoolNameForDedupe(p.name ?? '')
      if (norm && !proNames.has(norm)) {
        proNames.add(norm)
        rawList.push({
          name: p.name,
          position: p.position ?? '—',
          team: p.school ?? p.nflTeam ?? null,
          adp: p.devyAdp != null ? Number(p.devyAdp) : null,
          college: p.school ?? null,
          isDevy: true,
          school: p.school ?? null,
          classYearLabel: p.classYearLabel ?? null,
          draftGrade: p.draftGrade ?? null,
          projectedLandingSpot: p.nflTeam ?? null,
          draftEligibleYear: p.draftEligibleYear ?? null,
          graduatedToNFL: false,
          playerId: p.id ?? null,
          ...(c2cEnabled || devyEnabled ? { poolType: 'college' as const } : {}),
        })
      }
    }
  }

  let rawListFiltered = rawList
  // Type cast is widened to include `playerId` so keeper entries that carry an
  // external player-id (but no name) are also excluded from the pool.
  const keeperSelections = draftSession?.keeperSelections as Array<{ playerName?: string; playerId?: string | null }> | null
  if (Array.isArray(keeperSelections) && keeperSelections.length > 0) {
    const keptNames = new Set(
      keeperSelections.map((k) => normalizeDraftPoolNameForDedupe(k.playerName ?? '')).filter(Boolean),
    )
    const keptPlayerIds = new Set(
      keeperSelections.map((k) => String(k.playerId ?? '').trim()).filter(Boolean),
    )
    if (keptNames.size > 0 || keptPlayerIds.size > 0) {
      rawListFiltered = rawList.filter((r: RawRow) => {
        if (keptNames.size > 0 && keptNames.has(normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? ''))) return false
        if (keptPlayerIds.size > 0) {
          const pid = String(r.playerId ?? r.id ?? r.sleeperId ?? '').trim()
          if (pid && keptPlayerIds.has(pid)) return false
        }
        return true
      })
    }
  }

  if (eligiblePositions?.size) {
    rawListFiltered = rawListFiltered.filter((r: RawRow) =>
      draftPoolRowMatchesEligiblePositions(r.position ?? r.pos ?? '', eligiblePositions),
    )
  }

  const analyticsByKey = new Map<
    string,
    {
      fantasyPointsPerGame: number | null
      lifetimeValue: number | null
      updatedAt: Date | null
      expectedFantasyPoints: number | null
    }
  >()
  let identityByPoolKey = new Map<string, { rollingInsightsPlayerId: string; confidence: 'high' }>()
  let riSeasonByPlayerId = new Map<string, RollingInsightsSeasonSlice>()

  if (sport === 'NFL' && rawListFiltered.length > 0) {
    const nameKeys = [
      ...new Set(
        rawListFiltered
          .map((r) => normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? ''))
          .filter(Boolean),
      ),
    ].slice(0, 1200)
    if (nameKeys.length > 0) {
      const perfAnalytics = perfStart(`7. playerAnalyticsSnapshot.findMany (n=${nameKeys.length})`)
      const analyticsRows = await prisma.playerAnalyticsSnapshot
        .findMany({
          where: { normalizedName: { in: nameKeys } },
          select: {
            normalizedName: true,
            position: true,
            fantasyPointsPerGame: true,
            lifetimeValue: true,
            expectedFantasyPoints: true,
            updatedAt: true,
          },
        })
        .catch(
          () =>
            [] as Array<{
              normalizedName: string
              position: string | null
              fantasyPointsPerGame: number | null
              lifetimeValue: number | null
              expectedFantasyPoints: number | null
              updatedAt: Date
            }>,
        )
      perfAnalytics()
      for (const row of analyticsRows) {
        const nk = normalizeDraftPoolNameForDedupe(row.normalizedName ?? '')
        const pk = normalizeKeyPart(row.position ?? '')
        if (!nk || !pk) continue
        analyticsByKey.set(`${nk}|${pk}`, {
          fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
          lifetimeValue: row.lifetimeValue ?? null,
          updatedAt: row.updatedAt ?? null,
          expectedFantasyPoints: row.expectedFantasyPoints ?? null,
        })
      }
    }

    const riRows = rawListFiltered.map((r: RawRow) => {
      const nk = normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')
      const pk = normalizeKeyPart(r.position ?? r.pos ?? '')
      const sid = r.playerId ?? r.sleeperId ?? r.id ?? null
      const sleeperCandidate = sid != null && String(sid).trim() !== '' ? String(sid).trim() : null
      return { nk, pk, sleeperCandidate }
    })
    const perfRiSeason = perfStart(`8. loadRollingInsightsSeasonByDraftPoolKey (n=${riRows.length})`)
    const loaded = await loadRollingInsightsSeasonByDraftPoolKey({ rows: riRows })
    perfRiSeason()
    identityByPoolKey = loaded.identityByPoolKey
    riSeasonByPlayerId = loaded.riSeasonByPlayerId
  }

  let riDetailByPlayerId = new Map<string, RollingInsightsStatsDetailRow>()
  if (sport === 'NFL' && identityByPoolKey.size > 0) {
    const riIds = [...new Set([...identityByPoolKey.values()].map((v) => v.rollingInsightsPlayerId))]
    const perfRiDetail = perfStart(`9. loadRollingInsightsStatsDetailByPlayerIds (n=${riIds.length})`)
    riDetailByPlayerId = await loadRollingInsightsStatsDetailByPlayerIds(riIds)
    perfRiDetail()
  }

  // F.1: Fallback PlayerSeasonStats loader for rows without RI identity
  let fallbackSeasonByPoolKey = new Map<string, RollingInsightsSeasonSlice>()
  let playerSeasonStatsDiagnostics = { exactIdHits: 0, namePositionHits: 0, ambiguousSkips: 0, misses: 0 }
  if (sport === 'NFL' && rawListFiltered.length > 0) {
    const fallbackRows = rawListFiltered.map((r: RawRow) => {
      const nk = normalizeDraftPoolNameForDedupe(r.name ?? r.playerName ?? r.full_name ?? '')
      const pk = normalizeKeyPart(r.position ?? r.pos ?? '')
      const poolKey = `${nk}|${pk}`
      const riId = identityByPoolKey.get(poolKey)?.rollingInsightsPlayerId ?? null
      const sid = r.playerId ?? r.sleeperId ?? r.id ?? null
      const sleeperCandidate = sid != null && String(sid).trim() !== '' ? String(sid).trim() : null
      return { poolKey, nk, pk, sleeperCandidate, existingRiId: riId }
    })

    const perfFallback = perfStart(
      `9b. loadPlayerSeasonStatsFallback (n=${rawListFiltered.length}, unidentified=${fallbackRows.filter((r) => !r.existingRiId).length})`,
    )
    const fallbackResult = await loadPlayerSeasonStatsFallback({ rows: fallbackRows })
    perfFallback()
    fallbackSeasonByPoolKey = fallbackResult.seasonByPoolKey
    playerSeasonStatsDiagnostics = fallbackResult.diagnostics
  }

  const nflStatsSeason = sport === 'NFL' ? defaultNflPlayerStatsSeason() : ''

  const jrAliasPresence = new Map<string, { jr: boolean; base: boolean }>()
  for (const row of rawListFiltered) {
    const name = row.name ?? row.playerName ?? row.full_name ?? ''
    const pos = row.position ?? row.pos ?? ''
    const team = row.team ?? row.teamAbbr ?? null
    const key = jrAliasBaseKey(name, pos, team)
    const existing = jrAliasPresence.get(key) ?? { jr: false, base: false }
    if (hasJrSuffix(name)) existing.jr = true
    else existing.base = true
    jrAliasPresence.set(key, existing)
  }
  const jrAliasConflictKeys = new Set(
    [...jrAliasPresence.entries()]
      .filter(([, v]) => v.jr && v.base)
      .map(([k]) => k),
  )

  /** E.1.5: prefer real backfilled headshots when SportsPlayer has them.
   * The backfill script `npm run backfill:player-headshots` populates SportsPlayer rows with
   * imageUrl values from ClearSports / SportsDB. This map indexes them by (normalizedName,
   * normalizedPosition) so the per-row enrichment below can swap a synthesized AF data-URI
   * placeholder for a real photo. The query is no-op when SportsPlayer is empty (today). */
  const sportsPlayerImageByNameKey = new Map<string, string>()
  const sportsPlayerSleeperIdByNameKey = new Map<string, string>()
  const sportsPlayerImageByLooseTeamKey = new Map<string, string>()
  const sportsPlayerSleeperIdByLooseTeamKey = new Map<string, string>()
  const sportsPlayerImageByStrictTeamKey = new Map<string, string>()
  const sportsPlayerSleeperIdByStrictTeamKey = new Map<string, string>()
  if (rawListFiltered.length > 0) {
    try {
      /**
       * Bug fix (post-E.1.6): every NFL player has TWO SportsPlayer rows — one
       * `source='rolling_insights'` (from syncNFLPlayersToDb, sometimes carrying a
       * naked-filename URL like "ee4a97dd-...png" with no protocol) and one
       * `source='backfill'` (from scripts/backfill-player-headshots.ts, with a
       * real ClearSports/SportsDB/TheSportsAPI URL).
       *
       * Two corrections:
       *   1. Order by source DESC alphabetical so thesportsdb rows are seen first
       *      (priority: thesportsdb > sleeper > rolling_insights > backfill) — the
       *      first valid URL to be set for a (name, position) key wins; lower-quality
       *      sources only fill gaps.
       *   2. Validate the URL via classifyAvatarSource before caching — naked
       *      filenames (no `https://`) classify as `'null'` and are skipped, so
       *      they can never poison the map.
       */
      const perfSportsPlayer = perfStart(`6. sportsPlayer.findMany sport=${sport} (take=10000)`)
      const csPlayers = await prisma.sportsPlayer.findMany({
        where: {
          sport: sport as any,
          OR: [{ imageUrl: { not: null } }, { sleeperId: { not: null } }],
        },
        select: { name: true, position: true, team: true, imageUrl: true, source: true, sleeperId: true },
        take: 10000,
        orderBy: [{ source: 'desc' }],
        // Source priority (desc alphabetical, first-wins): thesportsdb > sleeper > rolling_insights > backfill
        // TheSportsDB transparent-cutout images are highest quality; Sleeper CDN fills gaps.
      })
      perfSportsPlayer()
      for (const row of csPlayers) {
        const nk = normalizeDraftPoolNameForDedupe(row.name ?? '')
        // normalizePositionForMapKey converts TheSportsDB full names ("Wide Receiver",
        // "Running Back") to the same abbreviations used by pool rows ("WR", "RB"),
        // so the map keys match the lookup keys constructed from pool row positions.
        const pk = normalizePositionForMapKey(row.position ?? '')
        const tk = normalizeKeyPart(row.team ?? '')
        const strictTeamKey = strictIdentityKeyWithTeam(row.name ?? '', row.position ?? '', row.team ?? null)
        // Use the already-normalized pk so the looseTeamKey matches pool row lookup keys.
        // loosePlayerTeamKey() would re-normalize from raw position, producing
        // "devon achane|running back|mia" instead of the correct "devon achane|rb|mia".
        const looseTeamKey = nk && pk && tk ? `${nk}|${pk}|${tk}` : ''
        if (!nk) continue
        const keyWithPos = `${nk}|${pk}`
        const keyNameOnly = `${nk}|`
        if (looksLikeSleeperNumericId(row.sleeperId)) {
          if (tk && strictTeamKey && !sportsPlayerSleeperIdByStrictTeamKey.has(strictTeamKey)) {
            sportsPlayerSleeperIdByStrictTeamKey.set(strictTeamKey, String(row.sleeperId).trim())
          }
          if (!sportsPlayerSleeperIdByNameKey.has(keyWithPos)) {
            sportsPlayerSleeperIdByNameKey.set(keyWithPos, String(row.sleeperId).trim())
          }
          if (!sportsPlayerSleeperIdByNameKey.has(keyNameOnly)) {
            sportsPlayerSleeperIdByNameKey.set(keyNameOnly, String(row.sleeperId).trim())
          }
          if (looseTeamKey && tk && !sportsPlayerSleeperIdByLooseTeamKey.has(looseTeamKey)) {
            sportsPlayerSleeperIdByLooseTeamKey.set(looseTeamKey, String(row.sleeperId).trim())
          }
        }
        if (!row.imageUrl) continue
        // Filter: must classify as a real headshot URL (https://, not data: URI,
        // not /teamLogos/ path, not a naked filename).
        if (classifyAvatarSource(row.imageUrl) !== 'headshot') continue
        if (tk && strictTeamKey && !sportsPlayerImageByStrictTeamKey.has(strictTeamKey)) {
          sportsPlayerImageByStrictTeamKey.set(strictTeamKey, row.imageUrl)
        }
        // Prefer (name|position). Also store name-only as a fallback when position is missing.
        if (!sportsPlayerImageByNameKey.has(keyWithPos)) sportsPlayerImageByNameKey.set(keyWithPos, row.imageUrl)
        if (!sportsPlayerImageByNameKey.has(keyNameOnly)) sportsPlayerImageByNameKey.set(keyNameOnly, row.imageUrl)
        if (looseTeamKey && tk && !sportsPlayerImageByLooseTeamKey.has(looseTeamKey)) {
          sportsPlayerImageByLooseTeamKey.set(looseTeamKey, row.imageUrl)
        }
      }
    } catch {
      /* swallow — pool falls through to placeholder behavior */
    }
  }

  /**
   * D.5 — overlay AI ADP from `AllFantasyAdpSnapshot` keyed by the league's draft
   * context (sport / leagueType / draftType / scoring / rosterFormat / teamCount /
   * season). Default draftMode is 'real'. If no snapshot rows match, the map is
   * empty and downstream rows render em-dash for the AI ADP cell — by design,
   * the resolver does NOT fall back to external/market ADP and label it AI ADP
   * (per D.5 spec).
   *
   * `aiAdpByPlayerKey.get('<lowercased name>|<lowercased position>')` returns
   *   { adp, sampleSize, lowSample, sevenDayTrend, thirtyDayTrend, standardDeviation }
   */
  const aiAdpByPlayerKey = new Map<
    string,
    {
      adp: number
      sampleSize: number
      lowSample: boolean
      sevenDayTrend: number | null
      thirtyDayTrend: number | null
      standardDeviation: number | null
    }
  >()
  if (rawListFiltered.length > 0) {
    try {
      const { buildContextHash } = await import('@/lib/adp/computeAllFantasyAdp')
      const settingsForCtx = (league?.settings as Record<string, unknown> | null) ?? {}
      const draftFromSettings = (settingsForCtx.draft as { type?: string } | undefined)?.type ?? draftSession?.draftType ?? 'snake'
      const ctxHash = buildContextHash({
        sport: String(sport ?? 'NFL').toUpperCase(),
        leagueType: league?.leagueVariant ?? (league?.isDynasty ? 'dynasty' : 'redraft'),
        draftType: String(draftFromSettings).toLowerCase(),
        scoringFormat: String(league?.scoring ?? 'ppr').toLowerCase(),
        rosterFormat: 'standard',
        teamCount: league?.leagueSize ?? 12,
        season: String(league?.season ?? new Date().getUTCFullYear()),
      })
      const perfAiAdp = perfStart('10. allFantasyAdpSnapshot.findMany')
      const adpRows = await prisma.allFantasyAdpSnapshot.findMany({
        where: { contextHash: ctxHash, draftMode: 'real' },
        select: {
          playerKey: true,
          averageOverallPick: true,
          sampleSize: true,
          sevenDayTrend: true,
          thirtyDayTrend: true,
          standardDeviation: true,
        },
        take: 4000,
      })
      perfAiAdp()
      const LOW_SAMPLE_THRESHOLD = 10
      for (const row of adpRows) {
        aiAdpByPlayerKey.set(row.playerKey, {
          adp: row.averageOverallPick,
          sampleSize: row.sampleSize,
          lowSample: row.sampleSize < LOW_SAMPLE_THRESHOLD,
          sevenDayTrend: row.sevenDayTrend,
          thirtyDayTrend: row.thirtyDayTrend,
          standardDeviation: row.standardDeviation,
        })
      }
    } catch {
      /* swallow — pool renders em-dashes for the AI ADP column when snapshot is unavailable */
    }
  }

  const promotedMap = new Map<string, { school: string | null }>()
  if (devyEnabled || c2cEnabled || isDevyDynasty || isC2C) {
    const promotedRows = await (prisma as any).devyPlayer
      .findMany({
        where: { graduatedToNFL: true },
        select: { normalizedName: true, name: true, position: true, school: true },
        take: 3000,
      })
      .catch(() => [] as any[])
    for (const p of promotedRows) {
      const nameKey = normalizeDraftPoolNameForDedupe(p.name ?? '')
      const posKey = normalizeKeyPart(p.position ?? '')
      if (!nameKey || !posKey) continue
      promotedMap.set(`${nameKey}|${posKey}`, { school: p.school ?? null })
    }
  }

  /** D.7 — Sleeper-backed rookie lookup. Only built for NFL pools. The lookup is
   * `null` for non-NFL sports (no upstream years_exp available); UI surfaces a
   * "Rookie data unavailable" message in that case. Failures inside the helper
   * degrade silently to `hasData=false` rather than breaking the pool fetch. */
  let nflRookieLookup: NflRookieLookup | null = null
  let nflRookieFetchSource: NflRookieFetchSource | null = null
  if (sport === 'NFL') {
    // DB-FIRST NOTE: loadNflRookieLookup calls the Sleeper /players/nfl endpoint
    // (24h in-process memory cache). A future hardening pass should back this
    // with a DB-persisted SleeperPlayersCache table so no cold-start API call
    // is made from the pool read path. Failures degrade silently to hasData=false.
    const perfRookie = perfStart('11. loadNflRookieLookup (Sleeper API — 24h cache)')
    const rookieBundle = await loadNflRookieLookup().catch(() => null)
    nflRookieLookup = rookieBundle?.lookup ?? null
    nflRookieFetchSource = rookieBundle?.fetchSource ?? null
    perfRookie()
  }

  const perfSprMaps = perfStart('11b. sportsPlayerRecord maps (cross-sport stats/images)')
  const sprRecordMaps = await loadSportsPlayerRecordMapsForDraftPool(
    leagueId,
    sport,
    rawListFiltered.map((r) => ({
      name: String(r.name ?? r.playerName ?? r.full_name ?? ''),
      position: String(r.position ?? r.pos ?? ''),
      team: r.team ?? r.teamAbbr ?? null,
    })),
  )
  perfSprMaps()

  const enrichedList = rawListFiltered.map((row) => {
    const name = row.name ?? row.playerName ?? row.full_name ?? ''
    const position = row.position ?? row.pos ?? ''
    const team = row.team ?? row.teamAbbr ?? null
    const sourcePlayerId = row.playerId ?? row.id ?? null
    const sourceSleeperId =
      row.sleeperId ??
      (looksLikeSleeperNumericId(String(sourcePlayerId ?? '')) ? String(sourcePlayerId) : null)
    const jrAliasConflictKey = jrAliasBaseKey(name, position, team)
    const inJrAliasConflict = jrAliasConflictKeys.has(jrAliasConflictKey)
    const strict = `${normalizeKeyPart(name)}|${normalizeKeyPart(position)}|${normalizeKeyPart(team)}`
    const loose = `${normalizeKeyPart(name)}|${normalizeKeyPart(position)}`
    const poolMatch = poolByStrictKey.get(strict) ?? poolByLooseKey.get(loose)

    const poolExternalId = poolMatch?.external_source_id ? String(poolMatch.external_source_id).trim() : null
    const poolExternalIdAmbiguous = Boolean(
      poolExternalId &&
      looksLikeSleeperNumericId(poolExternalId) &&
      poolRows.filter((p) => String(p.external_source_id ?? '').trim() === poolExternalId)
        .map((p) => strictIdentityKeyWithTeam(p.full_name ?? '', p.position ?? '', p.team_abbreviation ?? null))
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i).length > 1,
    )
    const poolExternalIdForAssign = poolExternalIdAmbiguous ? null : poolExternalId

    /** Prefer resolved pool external id so SPR stats/images join the same row as SportsPlayer / DB pool. */
    const sprPoolRecordId =
      String(poolExternalIdForAssign ?? row.playerId ?? row.sleeperId ?? row.id ?? '').trim() || null
    const sprLookup = lookupSportsPlayerRecordAugmentDetailed(
      sprRecordMaps,
      sport,
      name,
      position,
      team,
      sprPoolRecordId,
    )
    const sprAug = sprLookup.augment
    const sprMeta = sprLookup.meta

    const poolPlayerIdForLog =
      String(row.playerId ?? row.id ?? row.sleeperId ?? '').trim() || null

    if (!sprAug) {
      logPlayerMismatchEventVoid({
        leagueId,
        sport: String(sport),
        poolPlayerId: poolPlayerIdForLog,
        poolExternalId: sprPoolRecordId,
        sportsPlayerRecordId: null,
        playerName: name,
        position,
        team: team ?? null,
        attemptedMatchType: sprMeta.matchType,
        confidence: sprMeta.confidence,
        reason: 'NO_SPORT_PLAYER_RECORD_MATCH',
        details: {
          lookupReason: sprMeta.reason,
          idLookupAttempted: sprMeta.idLookupAttempted,
          idLookupHit: sprMeta.idLookupHit,
        },
      })
    } else {
      if (sprMeta.strictHitAfterIdMiss) {
        logPlayerMismatchEventVoid({
          leagueId,
          sport: String(sport),
          poolPlayerId: poolPlayerIdForLog,
          poolExternalId: sprPoolRecordId,
          sportsPlayerRecordId: null,
          playerName: name,
          position,
          team: team ?? null,
          attemptedMatchType: 'strict',
          confidence: sprMeta.confidence,
          reason: 'ID_DRIFT_STRICT_MATCH_USED',
          details: {
            lookupReason: sprMeta.reason,
            poolExternalDidNotMatchSprById: sprMeta.idLookupAttempted && !sprMeta.idLookupHit,
          },
        })
      }
      if (
        sprMeta.confidence < 0.9 &&
        team != null &&
        String(team).trim() !== '' &&
        !isNormalizedFreeAgentTeam(team)
      ) {
        logPlayerMismatchEventVoid({
          leagueId,
          sport: String(sport),
          poolPlayerId: poolPlayerIdForLog,
          poolExternalId: sprPoolRecordId,
          sportsPlayerRecordId: null,
          playerName: name,
          position,
          team: team ?? null,
          attemptedMatchType: sprMeta.matchType,
          confidence: sprMeta.confidence,
          reason: 'LOW_CONFIDENCE_MATCH',
          details: { lookupReason: sprMeta.reason },
        })
      }
    }

    const promoted = promotedMap.get(`${normalizeDraftPoolNameForDedupe(name)}|${normalizeKeyPart(position)}`)
    const poolAnalyticsKey = `${normalizeDraftPoolNameForDedupe(name)}|${normalizeKeyPart(position)}`
    const analytics = analyticsByKey.get(poolAnalyticsKey)
    const idn = identityByPoolKey.get(poolAnalyticsKey)
    const riSlice = idn ? riSeasonByPlayerId.get(idn.rollingInsightsPlayerId) ?? null : null
    // F.2: Fallback to PlayerSeasonStats if RI identity didn't resolve
    const fallbackRiSlice = !riSlice && sport === 'NFL' ? fallbackSeasonByPoolKey.get(poolAnalyticsKey) ?? null : null
    // Fallback matches are unambiguous name+position matches — treat with same confidence as RI
    const effectiveRiSlice = riSlice ?? fallbackRiSlice
    const effectiveConfidence: 'high' | 'none' = idn ? 'high' : effectiveRiSlice ? 'high' : 'none'
    const resolvedAnalytics =
      sport === 'NFL'
        ? resolveNflDraftPoolAnalytics({
            snapshot: analytics
              ? {
                  fantasyPointsPerGame: analytics.fantasyPointsPerGame,
                  lifetimeValue: analytics.lifetimeValue,
                  updatedAt: analytics.updatedAt,
                }
              : null,
            rollingInsights: effectiveRiSlice,
            identityMatchConfidence: effectiveConfidence,
            currentStatsSeason: nflStatsSeason,
          })
        : null

    const nflDraftProjectionSplits =
      sport === 'NFL'
        ? (buildNflDraftProjectionSplits({
            position,
            statsJson: idn ? riDetailByPlayerId.get(idn.rollingInsightsPlayerId)?.stats ?? null : null,
            snapshotExpectedPoints: analytics?.expectedFantasyPoints ?? null,
            riSeasonFantasyPoints: idn
              ? (riDetailByPlayerId.get(idn.rollingInsightsPlayerId)?.fantasyPoints ??
                  riSlice?.fantasyPointsSeason ??
                  null)
              : null,
            projectedPointsPerGame:
              resolvedAnalytics?.fantasyPointsPerGame ?? analytics?.fantasyPointsPerGame ?? null,
          }) ?? emptyNflDraftProjectionSplits())
        : null

    /** E.1.5: real headshot lookup from the backfilled SportsPlayer cache, keyed by
     * (normalizedName | normalizedPosition). Wins over synth/data-URI/team-logo URLs that the
     * upstream pool produced — but only when classifyAvatarSource flags the upstream as bogus.
     * If there's no cache hit, leave the upstream URL alone so the runtime PlayerAvatar's
     * classifier still rejects it and falls back to the silhouette. */
    let backfilledHeadshot: string | null = null
    if (!inJrAliasConflict) {
      /** Phase 2 — image confidence ladder
       *  1. Loose team key  (name + position + team)  — highest confidence when team is known.
       *  2. Name + position match                     — fills gaps when team differs between sources.
       *  3. Name-only match (no team on pool row)     — last resort; skipped when team is present
       *     to avoid mis-assigning a same-name player on a different roster (e.g., two Tyler Johnsons).
       */
      const lookupName = normalizeDraftPoolNameForDedupe(name)
      const lookupTeam = team && !isFreeAgentTeam(team)
      const looseTeamKey = loosePlayerTeamKey(name, position, team)
      const teamMatch = lookupTeam ? sportsPlayerImageByLooseTeamKey.get(looseTeamKey) : null
      const namePosMatch = sportsPlayerImageByNameKey.get(`${lookupName}|${normalizeKeyPart(position)}`) ?? null
      const nameOnlyMatch = !lookupTeam ? sportsPlayerImageByNameKey.get(`${lookupName}|`) : null
      backfilledHeadshot = teamMatch ?? namePosMatch ?? nameOnlyMatch ?? null
    }

    /** D.5 — AI ADP overlay from AllFantasyAdpSnapshot. The map is keyed by
     * `<normalized name>|<normalized position>` matching the same shape the
     * recompute script writes (see lib/adp/computeAllFantasyAdp.buildPlayerKey). */
    const aiAdpHit = aiAdpByPlayerKey.get(
      `${normalizeDraftPoolNameForDedupe(name ?? '')}|${normalizeKeyPart(position ?? '')}`,
    )
    const averagedAdpHit =
      averagedAdpStrict.get(adpLookupKey(name ?? '', position ?? '', team ?? null)) ??
      averagedAdpLoose.get(adpLookupKeyLoose(name ?? '', position ?? '')) ??
      null
    const resolvedAdp =
      resolvePreferredAdp(row.adp ?? null, averagedAdpHit) ??
      (sprAug?.adp != null && Number.isFinite(Number(sprAug.adp)) && Number(sprAug.adp) > 0
        ? Number(sprAug.adp)
        : null)

    const sprSupplementFppg =
      sprAug?.fantasyPointsPerGame != null &&
      Number.isFinite(Number(sprAug.fantasyPointsPerGame)) &&
      Number(sprAug.fantasyPointsPerGame) > 0 &&
      (sport !== 'NFL' ||
        ((analytics?.fantasyPointsPerGame == null || !Number.isFinite(Number(analytics.fantasyPointsPerGame))) &&
          (resolvedAnalytics?.fantasyPointsPerGame == null ||
            !Number.isFinite(Number(resolvedAnalytics.fantasyPointsPerGame)))))
        ? Number(sprAug.fantasyPointsPerGame)
        : null

    const backfilledSleeperId = !inJrAliasConflict
        ? (() => {
            /** Phase 2 — sleeperId confidence ladder
             *  Same 3-tier structure as the image ladder above.
             */
            const lookupName = normalizeDraftPoolNameForDedupe(name)
            const lookupTeam = team && !isFreeAgentTeam(team)
            const looseTeamKey = loosePlayerTeamKey(name, position, team)
            const teamMatch = lookupTeam ? sportsPlayerSleeperIdByLooseTeamKey.get(looseTeamKey) : null
            const namePosMatch = sportsPlayerSleeperIdByNameKey.get(`${lookupName}|${normalizeKeyPart(position)}`) ?? null
            const nameOnlyMatch = !lookupTeam ? sportsPlayerSleeperIdByNameKey.get(`${lookupName}|`) : null
            return teamMatch ?? namePosMatch ?? nameOnlyMatch ?? null
          })()
        : null

    const sprHeadshotUrl =
      sprAug?.headshotUrl && classifyAvatarSource(sprAug.headshotUrl) === 'headshot'
        ? sprAug.headshotUrl
        : null

    const injuryIdCandidates = [
      sourcePlayerId,
      sourceSleeperId,
      row.playerId ? String(row.playerId).trim() : null,
      row.sleeperId ? String(row.sleeperId).trim() : null,
      row.id ? String(row.id).trim() : null,
      poolExternalIdForAssign,
      poolMatch?.player_id ? String(poolMatch.player_id).trim() : null,
    ]
      .filter((v): v is string => Boolean(v && String(v).trim()))
      .map((v) => v.trim())

    let dbInjuryHit: InjuryLookupRow | null = null
    for (const idCandidate of injuryIdCandidates) {
      const idHit = injuryByPlayerId.get(idCandidate)
      if (idHit) {
        dbInjuryHit = idHit
        break
      }
    }
    if (!dbInjuryHit) {
      const teamCandidate =
        row.team ?? row.teamAbbr ?? poolMatch?.team_abbreviation ?? null
      const byNameTeam = injuryByNameTeam.get(injuryNameTeamKey(name, teamCandidate))
      dbInjuryHit = byNameTeam ?? null
    }
    if (!dbInjuryHit) {
      dbInjuryHit = injuryByName.get(injuryNameKey(name)) ?? null
    }

    const resolvedRawInjuryStatus =
      dbInjuryHit?.status ?? row.injuryStatus ?? row.status ?? poolMatch?.injury_status ?? null
    const resolvedRawGameStatus =
      dbInjuryHit?.gameStatus ?? row.status ?? poolMatch?.status ?? null
    const normalizedInjuryStatus = normalizeDraftPoolInjuryStatus(
      resolvedRawInjuryStatus,
      resolvedRawGameStatus,
    )

    const base = poolMatch
      ? {
          ...row,
          team: row.team ?? row.teamAbbr ?? poolMatch.team_abbreviation ?? null,
          teamAbbr: row.teamAbbr ?? row.team ?? poolMatch.team_abbreviation ?? null,
          playerId: row.playerId ?? row.sleeperId ?? row.id ?? poolExternalIdForAssign ?? null,
          sleeperId:
            row.sleeperId ??
            (looksLikeSleeperNumericId(poolExternalIdForAssign) ? poolExternalIdForAssign : null) ??
            backfilledSleeperId ??
            null,
          injuryStatus: normalizedInjuryStatus,
          status: dbInjuryHit?.gameStatus ?? row.status ?? poolMatch.status ?? null,
          secondaryPositions: Array.isArray(poolMatch.secondary_positions) ? poolMatch.secondary_positions : undefined,
          age: (row as RawRow).age ?? (poolMatch as { age?: number | null }).age ?? null,
          adp: resolvedAdp,
          imageUrl:
            backfilledHeadshot ??
            sprHeadshotUrl ??
            (row as RawRow).imageUrl ??
            (poolMatch as { image_url?: string | null }).image_url ??
            null,
          sourcePlayerId,
          sourceSleeperId,
        }
      : {
          ...row,
          sleeperId:
            row.sleeperId ??
            (looksLikeSleeperNumericId(String(row.playerId ?? '')) ? String(row.playerId) : null) ??
            backfilledSleeperId ??
            null,
          injuryStatus: normalizedInjuryStatus,
          status: dbInjuryHit?.gameStatus ?? row.status ?? null,
          adp: resolvedAdp,
          imageUrl: backfilledHeadshot ?? sprHeadshotUrl ?? (row as RawRow).imageUrl ?? null,
          sourcePlayerId,
          sourceSleeperId,
        }
    return {
      ...base,
      graduatedToNFL: row.graduatedToNFL ?? (promoted ? true : undefined),
      school: row.school ?? promoted?.school ?? null,
      college: row.college ?? promoted?.school ?? null,
      fantasyPointsPerGame:
        resolvedAnalytics?.fantasyPointsPerGame ??
        analytics?.fantasyPointsPerGame ??
        sprSupplementFppg ??
        (row as RawRow).fantasyPointsPerGame ??
        undefined,
      lifetimeValue:
        resolvedAnalytics?.lifetimeValue ??
        analytics?.lifetimeValue ??
        (row as RawRow).lifetimeValue ??
        undefined,
      rollingInsightsSupplemental: resolvedAnalytics?.rollingInsightsSupplemental ?? undefined,
      ...(sport === 'NFL' && nflDraftProjectionSplits ? { nflDraftProjectionSplits } : {}),
      /** D.5 — AI ADP comes from AllFantasyAdpSnapshot ONLY. Empty when no snapshot
       * exists for this context — the table renders em-dashes (no external ADP fallback). */
      ...(aiAdpHit
        ? {
            aiAdp: aiAdpHit.adp,
            aiAdpSampleSize: aiAdpHit.sampleSize,
            aiAdpLowSample: aiAdpHit.lowSample,
            aiAdpSevenDayTrend: aiAdpHit.sevenDayTrend,
            aiAdpThirtyDayTrend: aiAdpHit.thirtyDayTrend,
            aiAdpStandardDeviation: aiAdpHit.standardDeviation,
          }
        : { aiAdp: null }),
      /** D.7 — attach Sleeper years_exp for NFL rows. Devy rows that have not
       * been promoted to the NFL retain `isRookie=true` regardless of yearsExp
       * (their Sleeper match is typically absent). Promoted rows fall through
       * to the Sleeper lookup so a former devy player who has played a season
       * is correctly excluded from "Rookies Only" in redraft. */
      ...(sport === 'NFL'
        ? (() => {
            // Preserve explicit source value first; only backfill when missing.
            const explicitYearsExp =
              row.yearsExp != null && Number.isFinite(Number(row.yearsExp))
                ? Number(row.yearsExp)
                : null
            if (explicitYearsExp != null) {
              return { yearsExp: explicitYearsExp, rookieYearsExpSource: 'explicit_imported' as const }
            }

            const sleeperIdCandidate =
              sourceSleeperId ??
              (looksLikeSleeperNumericId(String(base.sleeperId ?? base.playerId ?? ''))
                ? String(base.sleeperId ?? base.playerId)
                : null)

            const ye = nflRookieLookup
              ? lookupYearsExp(nflRookieLookup, name, position, sleeperIdCandidate)
              : null
            if (ye != null) {
              return {
                yearsExp: ye,
                rookieYearsExpSource:
                  nflRookieFetchSource === 'sportsdatacache_compact'
                    ? ('sleeper_db_cache' as const)
                    : ('sleeper_live' as const),
              }
            }

            // Conservative fallback: if existing DB-backed analytics prove prior
            // NFL game participation/value, mark as veteran experience=1+.
            // Never infer rookie from this path.
            if (
              !row.isDevy &&
              hasVeteranEvidenceFromAnalytics({
                analytics,
                riSlice,
                resolvedSupplemental: resolvedAnalytics?.rollingInsightsSupplemental,
              })
            ) {
              return { yearsExp: 1, rookieYearsExpSource: 'analytics_veteran_inferred' as const }
            }

            return {}
          })()
        : {}),
      ...(row.isDevy && !row.graduatedToNFL
        ? { isRookie: true }
        : sport !== 'NFL' && sprAug?.rookieHint === true
          ? { isRookie: true }
          : {}),
    } as unknown as RawRow
  })

  resolveConflictingExternalIds(enrichedList as DraftPoolRawRow[])

  // Jr/non-Jr disambiguation guard: if both variants share the same team/pos and
  // currently point at the exact same non-Sleeper image URL, clear imageUrl so
  // normalize layer falls back to per-id Sleeper/template assets.
  const aliasBuckets = new Map<string, DraftPoolRawRow[]>()
  for (const row of enrichedList as DraftPoolRawRow[]) {
    const key = jrAliasBaseKey(row.name ?? row.playerName ?? row.full_name ?? '', row.position ?? row.pos ?? '', row.team ?? row.teamAbbr ?? null)
    const list = aliasBuckets.get(key) ?? []
    list.push(row)
    aliasBuckets.set(key, list)
  }
  for (const [key, group] of aliasBuckets.entries()) {
    if (!jrAliasConflictKeys.has(key) || group.length < 2) continue
    const jrRows = group.filter((r) => hasJrSuffix(r.name ?? r.playerName ?? r.full_name ?? ''))
    const baseRows = group.filter((r) => !hasJrSuffix(r.name ?? r.playerName ?? r.full_name ?? ''))
    for (const jrRow of jrRows) {
      for (const baseRow of baseRows) {
        const jrImg = String(jrRow.imageUrl ?? '').trim()
        const baseImg = String(baseRow.imageUrl ?? '').trim()
        const jrPid = String(jrRow.playerId ?? '').trim()
        const basePid = String(baseRow.playerId ?? '').trim()
        if (!jrImg || !baseImg || jrImg !== baseImg) continue
        if (jrPid && basePid && jrPid === basePid) continue
        if (/sleepercdn\.com\/content\/nfl\/players\/thumb\//i.test(jrImg)) continue
        jrRow.imageUrl = null
        baseRow.imageUrl = null
      }
    }
  }

  const dedupedEnrichedList = dedupeEnrichedRawRows(enrichedList as DraftPoolRawRow[])
  let entries = normalizePlayerList(dedupedEnrichedList, sport)
  entries = filterExcludedDraftEntries(
    entries,
    options.excludeDraftedNames,
    options.excludeDraftedPlayerIds,
  )

  // Phase 2: filter out teamless (free-agent/released) players from the live pool.
  // DEF/DST units are exempt — they legitimately may not carry a team abbreviation.
  entries = entries.filter((e) => {
    const pos = canonicalPosition(e.position ?? '')
    if (pos === 'DEF' || pos === 'DST') return true
    const team = e.team ?? null
    return team !== null && String(team).trim() !== '' && String(team).trim().toUpperCase() !== 'FA'
  })

  const { entries: entriesWithProjectionFallbacks, diagnostics: projectionDiagnostics } =
    await applyPositionAwareProjectionFallbacks({
      sport,
      entries,
    })
  entries = entriesWithProjectionFallbacks

  // Deterministic ranking: ADP-first when present, then AI ADP, then lexical tie-breakers.
  // This avoids visually jumbled boards when merged sources contribute mixed/null ADP values.
  entries = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareDraftEntriesByStableRank(a.entry, b.entry, a.index, b.index))
    .map((item) => item.entry)

  if (sport === 'NFL') {
    console.info('[draft-pool projections] diagnostics', {
      leagueId,
      realProjectionCount: projectionDiagnostics.realProjectionCount,
      fallbackProjectionCount: projectionDiagnostics.fallbackProjectionCount,
      fallbackBySource: projectionDiagnostics.fallbackBySource,
      stillMissingProjectionCount: projectionDiagnostics.stillMissingProjectionCount,
    })
  }

  perfTotal()
  console.info('[draft-perf] pool cold build done', {
    leagueId,
    sport,
    entryCount: entries.length,
    totalMs: Date.now() - _coldBuildStartMs,
  })

  return {
    entries,
    sport,
    count: entries.length,
    rosterConfigurationIncomplete: false,
    projectionDiagnostics,
    poolType: strictPoolSeparation ? poolType ?? undefined : undefined,
    devyConfig: devyEnabled ? { enabled: true, devyRounds: rawDevyConfig?.devyRounds ?? [] } : undefined,
    c2cConfig: c2cEnabled ? { enabled: true, collegeRounds: rawC2cConfig?.collegeRounds ?? [] } : undefined,
    isIdp: effectiveLeagueTemplate.idpEnabled || undefined,
  }
}
