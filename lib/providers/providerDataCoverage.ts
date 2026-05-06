/**
 * Read-only aggregates for sports_players cache rows — provider coverage audits.
 */

import type { LeagueSport } from '@prisma/client'

import {
  isDraftEligibleCollegeClass,
  isFreshmanClass,
  isGraduateClass,
  isJuniorClass,
  isSeniorClass,
  isSophomoreClass,
  isUnderclassmanClass,
  normalizeCollegeClass,
} from '@/lib/draft-room/collegeClass'
import { getRollingInsightsSportCode } from '@/lib/providers/rollingInsightsFieldMaps'
import {
  getPrimaryProviderForSport,
  getProviderPriorityForSport,
} from '@/lib/providers/providerPriority'
import { ROLLING_INSIGHTS_DOCS_REGISTRY } from '@/lib/providers/rollingInsightsDocsRegistry'
import {
  hasRollingInsightsSoccerRegularSeasonStats,
  isRollingInsightsSoccerTeamRelegated,
  normalizeRollingInsightsSoccerDraws,
} from '@/lib/providers/rollingInsightsSoccerTeamStats'
import { normalizeRollingInsightsSoccerStatus } from '@/lib/providers/rollingInsightsSoccerStatus'
import {
  normalizeSoccerLeague,
  type RollingInsightsSoccerLeagueCode,
} from '@/lib/providers/rollingInsightsSoccerLeague'
import { inferExperienceSourceFromDataSource } from '@/lib/player-data/providerExperienceFields'
import { hasClearSportsExperienceSignal } from '@/lib/providers/clearSportsFieldMaps'
import { hasTheSportsDbExperienceSignal } from '@/lib/providers/theSportsDbFieldMaps'

export type CoverageSportArg =
  | 'NFL'
  | 'NBA'
  | 'MLB'
  | 'NHL'
  | 'NCAAF'
  | 'NCAAFB'
  | 'NCAAB'
  | 'NCAABB'
  | 'SOCCER'
  | 'EPL'
  | 'LALIGA'
  | 'SERIEA'

export type MissingCoverageFlag =
  | 'rookie'
  | 'stats'
  | 'projections'
  | 'class'
  | 'schedule'
  | 'team_stats'
  | 'player_info'
  | 'team_info'

export type CoverageAggregateOptions = {
  /** When set, only rows whose JSON includes a matching RI soccer `league` (EPL/LALIGA/SERIEA) are counted. */
  soccerLeague?: string | null
}

export type PlayerRecordCoverageRow = {
  id: string
  name: string
  sport: string
  team: string
  position: string
  stats: unknown
  projections: unknown
  headshotUrl: string | null
  headshotUrlLg: string | null
  /** sports_players.data_source — coarse vendor bucket via `inferExperienceSourceFromDataSource` */
  dataSource?: string | null
  news?: unknown
}

function jsonNonEmpty(blob: unknown): boolean {
  return blob != null && typeof blob === 'object' && !Array.isArray(blob) && Object.keys(blob as object).length > 0
}

/** One-level merge for audits — experience scanners already flatten nested vendor blobs. */
function mergeStatsProjectionsNews(
  stats: unknown,
  projections: unknown,
  news?: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const pour = (blob: unknown) => {
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
      Object.assign(out, blob as Record<string, unknown>)
    }
  }
  pour(stats)
  pour(projections)
  pour(news)
  return out
}

/** Loose injury/report hints inside cached JSON (not a substitute for live injury feeds). */
function jsonHasInjurySignals(blob: unknown): boolean {
  const kw = /injury|injured|questionable|doubtful|out\b|ir\b|probable/gi
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 8 || v == null) return false
    if (typeof v === 'string') return kw.test(v)
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (kw.test(k)) return true
        if (walk(val, depth + 1)) return true
      }
    } else if (Array.isArray(v)) {
      for (const item of v) if (walk(item, depth + 1)) return true
    }
    return false
  }
  return walk(blob, 0)
}

function extractPositionCategory(blob: unknown): string | null {
  let cat: string | null = null
  const walk = (v: unknown, depth: number) => {
    if (cat != null || depth > 8 || v == null) return
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k.toLowerCase() === 'position_category' && typeof val === 'string') {
          cat = val.trim().toUpperCase()
          return
        }
        walk(val, depth + 1)
      }
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
    }
  }
  walk(blob, 0)
  return cat
}

/** Heuristic: daily schedule / game row fields on cached JSON. */
function jsonHasScheduleSignals(blob: unknown): boolean {
  const keys = new Set(['game_ID', 'away_team_ID', 'home_team_ID', 'game_time', 'event_name'])
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 8 || v == null) return false
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (keys.has(k)) return true
        if (walk(child, depth + 1)) return true
      }
    } else if (Array.isArray(v)) {
      for (const item of v) if (walk(item, depth + 1)) return true
    }
    return false
  }
  return walk(blob, 0)
}

/** Heuristic: team season stats bundle (`regular_season` defense/offense aggregates). */
function jsonHasTeamSeasonStatSignals(blob: unknown): boolean {
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 8 || v == null) return false
    if (typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      if ('regular_season' in o && o.regular_season && typeof o.regular_season === 'object') {
        const rs = o.regular_season as Record<string, unknown>
        return (
          rs.points != null ||
          rs.total_yards != null ||
          rs.defense_touchdowns != null ||
          rs.sacks != null ||
          rs.points_against_defense_special_teams != null ||
          rs.goals_scored != null ||
          rs.wins != null ||
          rs.goals_conceded != null
        )
      }
      if ('team_stats' in o && o.team_stats && typeof o.team_stats === 'object') {
        const ts = o.team_stats as Record<string, unknown>
        return ts.points_against_defense_special_teams != null || ts.total_yards != null || ts.sacks != null
      }
      for (const child of Object.values(o)) {
        if (walk(child, depth + 1)) return true
      }
    } else if (Array.isArray(v)) {
      for (const item of v) if (walk(item, depth + 1)) return true
    }
    return false
  }
  return walk(blob, 0)
}

function extractLeagueString(blob: unknown): string | null {
  let found: string | null = null
  const walk = (v: unknown, depth: number) => {
    if (found || depth > 8 || v == null) return
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k.toLowerCase() === 'league' && (typeof val === 'string' || typeof val === 'number')) {
          found = String(val)
          return
        }
        walk(val, depth + 1)
      }
    } else if (Array.isArray(v)) {
      for (const i of v) walk(i, depth + 1)
    }
  }
  walk(blob, 0)
  return found
}

function jsonContainsPlayerId(blob: unknown): boolean {
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 8 || v == null) return false
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'player_id' && (typeof val === 'string' || typeof val === 'number')) return true
        if (walk(val, depth + 1)) return true
      }
    } else if (Array.isArray(v)) {
      for (const i of v) if (walk(i, depth + 1)) return true
    }
    return false
  }
  return walk(blob, 0)
}

function countSoccerReplacedStatus(blob: unknown): number {
  let n = 0
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v == null) return
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k.toLowerCase() === 'status' && normalizeRollingInsightsSoccerStatus(val) === 'replaced') n += 1
        walk(val, depth + 1)
      }
    } else if (Array.isArray(v)) {
      for (const i of v) walk(i, depth + 1)
    }
  }
  walk(blob, 0)
  return n
}

function rowMatchesSoccerLeagueFilter(
  r: PlayerRecordCoverageRow,
  want: RollingInsightsSoccerLeagueCode,
): boolean {
  const a = extractLeagueString(r.stats)
  const b = extractLeagueString(r.projections)
  return (
    (a != null && normalizeSoccerLeague(a) === want) || (b != null && normalizeSoccerLeague(b) === want)
  )
}

function scanJsonSignals(blob: unknown): {
  hasStats: boolean
  hasRookieHints: boolean
  hasExperienceHints: boolean
  classLabel: string | null
} {
  let hasStats = false
  let hasRookieHints = false
  let hasExperienceHints = false
  let classLabel: string | null = null

  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v == null) return
    if (typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const kl = k.toLowerCase()
        if (kl === 'class' || kl === 'collegeclass') {
          if (typeof val === 'string' || typeof val === 'number') classLabel = String(val)
        }
        if (
          kl.includes('rookie') ||
          kl === 'isrookie' ||
          kl.includes('years_exp') ||
          kl.includes('yearsexp')
        ) {
          hasRookieHints = true
        }
        if (kl.includes('experience') || kl.includes('years_exp') || kl === 'yearsexp') {
          hasExperienceHints = true
        }
        walk(val, depth + 1)
      }
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1)
    }
  }

  if (blob && typeof blob === 'object') {
    const o = blob as Record<string, unknown>
    hasStats = Object.keys(o).length > 0
    walk(blob, 0)
  }
  return { hasStats, hasRookieHints, hasExperienceHints, classLabel }
}

export type CoverageAggregate = {
  sport: string
  rollingInsightsSportCode: string
  total: number
  withStatsJson: number
  withProjectionsJson: number
  withRookieSignals: number
  withExperienceSignals: number
  withTeam: number
  withPosition: number
  withImages: number
  playersWithCollegeClass: number
  collegeClassCounts: Record<string, number>
  playersFreshman: number
  playersSophomore: number
  playersJunior: number
  playersSenior: number
  playersGraduate: number
  playersUnderclassmen: number
  playersDraftEligible: number
  playersWithOffenseCategory: number
  playersWithDefenseCategory: number
  playersWithSpecialTeamsCategory: number
  rowsWithScheduleSignals: number
  rowsWithTeamSeasonStatSignals: number
  sampleMissing: PlayerRecordCoverageRow[]
  soccerLeagueFilter: string | null
  soccerWithPlayerId: number
  soccerWithLeagueKey: number
  soccerReplacedStatusHits: number
  soccerRelegatedNullRegularSeason: number
  soccerWithDrawsOrTies: number
  /** Rows whose `data_source` maps to coarse buckets (see `inferExperienceSourceFromDataSource`). */
  providerRowsTaggedRollingInsights: number
  providerRowsTaggedTheSportsDb: number
  providerRowsTaggedClearSports: number
  providerRowsTaggedUnknown: number
  playersWithClearSportsExperienceSignals: number
  playersWithTheSportsDbExperienceSignals: number
  rowsWithInjuryKeywordSignals: number
}

export function aggregatePlayerRecordCoverage(
  rows: PlayerRecordCoverageRow[],
  sport: CoverageSportArg,
  options?: CoverageAggregateOptions,
): CoverageAggregate {
  const riCode = getRollingInsightsSportCode(sport)
  const isSoccer = riCode === 'SOCCER'
  const wantLeague = options?.soccerLeague?.trim()
    ? normalizeSoccerLeague(options.soccerLeague)
    : null
  let working = rows
  if (isSoccer && wantLeague) {
    working = rows.filter((r) => rowMatchesSoccerLeagueFilter(r, wantLeague))
  }

  let withStatsJson = 0
  let withProjectionsJson = 0
  let withRookieSignals = 0
  let withExperienceSignals = 0
  let withTeam = 0
  let withPosition = 0
  let withImages = 0
  let playersWithCollegeClass = 0
  const collegeClassCounts: Record<string, number> = {}
  let playersFreshman = 0
  let playersSophomore = 0
  let playersJunior = 0
  let playersSenior = 0
  let playersGraduate = 0
  let playersUnderclassmen = 0
  let playersDraftEligible = 0
  let playersWithOffenseCategory = 0
  let playersWithDefenseCategory = 0
  let playersWithSpecialTeamsCategory = 0
  let rowsWithScheduleSignals = 0
  let rowsWithTeamSeasonStatSignals = 0
  let soccerWithPlayerId = 0
  let soccerWithLeagueKey = 0
  let soccerReplacedStatusHits = 0
  let soccerRelegatedNullRegularSeason = 0
  let soccerWithDrawsOrTies = 0
  let providerRowsTaggedRollingInsights = 0
  let providerRowsTaggedTheSportsDb = 0
  let providerRowsTaggedClearSports = 0
  let providerRowsTaggedUnknown = 0
  let playersWithClearSportsExperienceSignals = 0
  let playersWithTheSportsDbExperienceSignals = 0
  let rowsWithInjuryKeywordSignals = 0

  for (const r of working) {
    const merged = mergeStatsProjectionsNews(r.stats, r.projections, r.news)
    const dsBucket = inferExperienceSourceFromDataSource(String(r.dataSource ?? ''))
    if (dsBucket === 'rolling_insights') providerRowsTaggedRollingInsights += 1
    else if (dsBucket === 'thesportsdb') providerRowsTaggedTheSportsDb += 1
    else if (dsBucket === 'clearsports') providerRowsTaggedClearSports += 1
    else providerRowsTaggedUnknown += 1

    if (hasClearSportsExperienceSignal(merged)) playersWithClearSportsExperienceSignals += 1
    if (hasTheSportsDbExperienceSignal(merged)) playersWithTheSportsDbExperienceSignals += 1
    if (
      jsonHasInjurySignals(r.stats) ||
      jsonHasInjurySignals(r.projections) ||
      jsonHasInjurySignals(r.news)
    ) {
      rowsWithInjuryKeywordSignals += 1
    }

    const ss = scanJsonSignals(r.stats)
    const ps = scanJsonSignals(r.projections)
    if (jsonNonEmpty(r.stats) || ss.hasStats) withStatsJson += 1
    if (jsonNonEmpty(r.projections)) withProjectionsJson += 1
    if (ss.hasRookieHints || ps.hasRookieHints) withRookieSignals += 1
    if (ss.hasExperienceHints || ps.hasExperienceHints) withExperienceSignals += 1
    if (r.team?.trim()) withTeam += 1
    if (r.position?.trim()) withPosition += 1
    if (r.headshotUrl?.trim() || r.headshotUrlLg?.trim()) withImages += 1

    const cls = ss.classLabel ?? ps.classLabel
    if (cls) {
      playersWithCollegeClass += 1
      const norm = normalizeCollegeClass(cls)
      collegeClassCounts[norm] = (collegeClassCounts[norm] ?? 0) + 1
      if (isFreshmanClass(cls)) playersFreshman += 1
      if (isSophomoreClass(cls)) playersSophomore += 1
      if (isJuniorClass(cls)) playersJunior += 1
      if (isSeniorClass(cls)) playersSenior += 1
      if (isGraduateClass(cls)) playersGraduate += 1
      if (isUnderclassmanClass(cls)) playersUnderclassmen += 1
      if (isDraftEligibleCollegeClass(cls)) playersDraftEligible += 1
    }

    const posCat =
      extractPositionCategory(r.stats) ?? extractPositionCategory(r.projections)
    if (posCat === 'OFF') playersWithOffenseCategory += 1
    if (posCat === 'DEF') playersWithDefenseCategory += 1
    if (posCat === 'ST') playersWithSpecialTeamsCategory += 1

    if (jsonHasScheduleSignals(r.stats) || jsonHasScheduleSignals(r.projections)) {
      rowsWithScheduleSignals += 1
    }
    if (jsonHasTeamSeasonStatSignals(r.stats) || jsonHasTeamSeasonStatSignals(r.projections)) {
      rowsWithTeamSeasonStatSignals += 1
    }

    if (isSoccer) {
      if (jsonContainsPlayerId(r.stats) || jsonContainsPlayerId(r.projections)) soccerWithPlayerId += 1
      if (extractLeagueString(r.stats) ?? extractLeagueString(r.projections)) soccerWithLeagueKey += 1
      soccerReplacedStatusHits += countSoccerReplacedStatus(r.stats) + countSoccerReplacedStatus(r.projections)

      let sawRelegatedNull = false
      let sawDrawsOrTies = false
      for (const blob of [r.stats, r.projections]) {
        if (!blob || typeof blob !== 'object') continue
        const o = blob as Record<string, unknown>
        if (
          !sawRelegatedNull &&
          isRollingInsightsSoccerTeamRelegated(o) &&
          !hasRollingInsightsSoccerRegularSeasonStats(o)
        ) {
          soccerRelegatedNullRegularSeason += 1
          sawRelegatedNull = true
        }
        if (
          !sawDrawsOrTies &&
          normalizeRollingInsightsSoccerDraws(o.regular_season as Record<string, unknown>) != null
        ) {
          soccerWithDrawsOrTies += 1
          sawDrawsOrTies = true
        }
      }
    }
  }

  return {
    sport,
    rollingInsightsSportCode: riCode,
    total: working.length,
    withStatsJson,
    withProjectionsJson,
    withRookieSignals,
    withExperienceSignals,
    withTeam,
    withPosition,
    withImages,
    playersWithCollegeClass,
    collegeClassCounts,
    playersFreshman,
    playersSophomore,
    playersJunior,
    playersSenior,
    playersGraduate,
    playersUnderclassmen,
    playersDraftEligible,
    playersWithOffenseCategory,
    playersWithDefenseCategory,
    playersWithSpecialTeamsCategory,
    rowsWithScheduleSignals,
    rowsWithTeamSeasonStatSignals,
    soccerLeagueFilter: wantLeague ?? null,
    soccerWithPlayerId,
    soccerWithLeagueKey,
    soccerReplacedStatusHits,
    soccerRelegatedNullRegularSeason,
    soccerWithDrawsOrTies,
    providerRowsTaggedRollingInsights,
    providerRowsTaggedTheSportsDb,
    providerRowsTaggedClearSports,
    providerRowsTaggedUnknown,
    playersWithClearSportsExperienceSignals,
    playersWithTheSportsDbExperienceSignals,
    rowsWithInjuryKeywordSignals,
    sampleMissing: [],
  }
}

export function filterRowsMissing(
  rows: PlayerRecordCoverageRow[],
  flag: MissingCoverageFlag,
  sport: CoverageSportArg,
  options?: CoverageAggregateOptions,
): PlayerRecordCoverageRow[] {
  const needCollegeClass =
    sport === 'NCAAF' ||
    sport === 'NCAAFB' ||
    sport === 'NCAAB' ||
    sport === 'NCAABB'
  const needNcaaFbSignals = sport === 'NCAAF' || sport === 'NCAAFB'
  const needSoccerSignals = getRollingInsightsSportCode(sport) === 'SOCCER'
  const wantSoccerLeague = options?.soccerLeague?.trim()
    ? normalizeSoccerLeague(options.soccerLeague)
    : null

  const out: PlayerRecordCoverageRow[] = []
  for (const r of rows) {
    const ss = scanJsonSignals(r.stats)
    const ps = scanJsonSignals(r.projections)
    if (flag === 'stats' && !ss.hasStats) out.push(r)
    if (flag === 'projections' && !ps.hasStats) out.push(r)
    if (flag === 'rookie' && !ss.hasRookieHints && !ps.hasRookieHints) out.push(r)
    if (flag === 'class') {
      const cls = ss.classLabel ?? ps.classLabel
      if (needCollegeClass && !cls) out.push(r)
    }
    if (flag === 'schedule') {
      const missingSchedule =
        !jsonHasScheduleSignals(r.stats) &&
        !jsonHasScheduleSignals(r.projections) &&
        (needNcaaFbSignals || needSoccerSignals)
      if (missingSchedule) out.push(r)
    }
    if (flag === 'team_stats') {
      const missingTs =
        !jsonHasTeamSeasonStatSignals(r.stats) &&
        !jsonHasTeamSeasonStatSignals(r.projections) &&
        (needNcaaFbSignals || needSoccerSignals)
      if (missingTs) out.push(r)
    }
    if (flag === 'player_info') {
      if (
        needSoccerSignals &&
        (!wantSoccerLeague || rowMatchesSoccerLeagueFilter(r, wantSoccerLeague)) &&
        !jsonContainsPlayerId(r.stats) &&
        !jsonContainsPlayerId(r.projections)
      ) {
        out.push(r)
      }
    }
    if (flag === 'team_info') {
      if (
        needSoccerSignals &&
        (!wantSoccerLeague || rowMatchesSoccerLeagueFilter(r, wantSoccerLeague)) &&
        !extractLeagueString(r.stats) &&
        !extractLeagueString(r.projections)
      ) {
        out.push(r)
      }
    }
  }
  return out.slice(0, 50)
}

export function formatCoverageReport(
  agg: CoverageAggregate,
  sport: string,
): string {
  const reg = ROLLING_INSIGHTS_DOCS_REGISTRY.find(
    (e) =>
      e.sport === sport ||
      (sport === 'NCAAF' && e.sport === 'NCAAF') ||
      (sport === 'NCAAB' && e.sport === 'NCAABB') ||
      (sport === 'SOCCER' && e.sport === 'SOCCER') ||
      (normalizeSoccerLeague(sport) && e.sport === 'SOCCER'),
  )
  const lines = [
    `sport=${agg.sport} riCode=${agg.rollingInsightsSportCode}`,
    `total=${agg.total} statsJson=${agg.withStatsJson} projectionsJson=${agg.withProjectionsJson}`,
    `rookieHints=${agg.withRookieSignals} experienceHints=${agg.withExperienceSignals}`,
    `team=${agg.withTeam} position=${agg.withPosition} images=${agg.withImages}`,
    `collegeClass=${agg.playersWithCollegeClass} freshman=${agg.playersFreshman} sophomore=${agg.playersSophomore} junior=${agg.playersJunior} senior=${agg.playersSenior} graduate=${agg.playersGraduate}`,
    `underclassmen=${agg.playersUnderclassmen} draftEligible=${agg.playersDraftEligible}`,
    `posCat(off/def/st)=${agg.playersWithOffenseCategory}/${agg.playersWithDefenseCategory}/${agg.playersWithSpecialTeamsCategory}`,
    `scheduleSignals=${agg.rowsWithScheduleSignals} teamSeasonStatSignals=${agg.rowsWithTeamSeasonStatSignals}`,
    ...(agg.rollingInsightsSportCode === 'SOCCER'
      ? [
          `soccerLeagueFilter=${agg.soccerLeagueFilter ?? 'none'}`,
          `soccer player_id=${agg.soccerWithPlayerId} leagueKey=${agg.soccerWithLeagueKey} replacedHits=${agg.soccerReplacedStatusHits}`,
          `soccer relegatedNullRS=${agg.soccerRelegatedNullRegularSeason} drawsOrTies=${agg.soccerWithDrawsOrTies}`,
        ]
      : []),
    `primaryProvider=${getPrimaryProviderForSport(sport)}`,
    `chain=${getProviderPriorityForSport(sport).join('>')}`,
    reg ? `docStatus=${reg.status}` : 'docStatus=n/a',
    `providerTags ri/tsdb/cs/unknown=${agg.providerRowsTaggedRollingInsights}/${agg.providerRowsTaggedTheSportsDb}/${agg.providerRowsTaggedClearSports}/${agg.providerRowsTaggedUnknown}`,
    `experienceSignals clearSports/tsdb=${agg.playersWithClearSportsExperienceSignals}/${agg.playersWithTheSportsDbExperienceSignals}`,
    `injuryKeywordSignals=${agg.rowsWithInjuryKeywordSignals}`,
  ]
  return lines.join('\n')
}

export type { LeagueSport }
