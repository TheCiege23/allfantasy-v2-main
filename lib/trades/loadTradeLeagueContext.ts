import 'server-only'

import type { LeagueSport } from '@prisma/client'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'

type JsonObject = Record<string, unknown>

type TradeLeagueTeam = {
  id: string
  externalId: string
  name: string
  claimedByUserId: string | null
  record: { wins: number; losses: number; ties: number }
  rank: number | null
}

type TradeLeagueContext = {
  leagueId: string
  platformLeagueId: string
  name: string | null
  platform: string
  sport: LeagueSport
  season: number
  format: string | null
  dynasty: boolean
  teamCount: number | null
  scoringMode: 'points' | 'h2h_category' | 'roto' | 'unknown'
  categoryPresetId: string | null
  scoringRules: Record<string, number>
  scoringRuleDetails: Array<{ statKey: string; pointsValue: number; positions: string[] }>
  starterSlots: Record<string, number>
  benchSlots: number | null
  irSlots: number | null
  taxiSlots: number | null
  waiverBudget: number | null
  teams: TradeLeagueTeam[]
  /** A Fantrax account may own several teams in one league. */
  viewerTeamIds: string[]
  missing: Array<'team_count' | 'scoring_rules' | 'roster_slots' | 'teams'>
}

type LeagueRow = {
  id: string
  platformLeagueId: string
  name: string | null
  platform: string
  sport: LeagueSport
  season: number
  leagueType: string | null
  isDynasty: boolean
  leagueSize: number | null
  scoring: string | null
  settings: unknown
  starters: unknown
  waiverBudget: number | null
  taxiSlots: number | null
  irSlots: number | null
}

type TeamRow = {
  id: string
  externalId: string
  teamName: string
  claimedByUserId: string | null
  wins: number
  losses: number
  ties: number
  currentRank: number | null
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

function positiveInteger(value: unknown): number | null {
  const n = nonNegativeInteger(value)
  return n !== null && n > 0 ? n : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numericRules(value: unknown): Record<string, number> {
  const source = object(value)
  if (!source) return {}
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  )
}

function ruleDetails(value: unknown): TradeLeagueContext['scoringRuleDetails'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = object(item)
    const statKey = typeof row?.statKey === 'string' ? row.statKey.trim() : ''
    const pointsValue = finiteNumber(row?.pointsValue)
    if (!statKey || pointsValue === null) return []
    return [{
      statKey,
      pointsValue,
      positions: Array.isArray(row?.positions)
        ? row.positions.filter((position): position is string => typeof position === 'string')
        : [],
    }]
  })
}

/** Sleeper stores one label per slot; ESPN and Fantrax also use LABEL:count. */
function slotsFromArray(value: unknown, sport: LeagueSport): {
  starters: Record<string, number>; bench: number; ir: number; taxi: number
} | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const starters: Record<string, number> = {}
  let bench = 0
  let ir = 0
  let taxi = 0
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const [labelRaw, countRaw] = raw.trim().toUpperCase().split(':')
    const label = labelRaw?.trim()
    const count = countRaw === undefined ? 1 : positiveInteger(countRaw)
    if (!label || !count) continue
    if (label === 'BN' || label === 'BE') bench += count
    else if (label === 'TAXI') taxi += count
    else if (['IR', 'IL', 'NA'].includes(label) || (label === 'DL' && !['NFL', 'NCAAF'].includes(sport))) ir += count
    else starters[label] = (starters[label] ?? 0) + count
  }
  return { starters, bench, ir, taxi }
}

function slotsFromObject(value: unknown): Record<string, number> {
  const source = object(value)
  if (!source) return {}
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => {
      const count = positiveInteger(value)
      return count ? [[key.trim().toUpperCase(), count] as const] : []
    }),
  )
}

function scoringMode(value: unknown): TradeLeagueContext['scoringMode'] {
  const mode = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (mode === 'h2h_category' || mode === 'h2h_categories' || mode === 'categories' || mode === 'category') return 'h2h_category'
  if (mode === 'roto' || mode === 'rotisserie') return 'roto'
  if (mode === 'points' || mode === 'h2h_points' || mode === 'head_to_head_points_based' ||
    mode === 'total_points_based' || mode === 'standard' || mode === 'ppr' || mode === 'half_ppr') return 'points'
  return 'unknown'
}

/** Re-read the provider's grouped rules so legacy Fantrax NHL imports retain goalie weights. */
function fantraxNhlRules(settings: JsonObject | null): Record<string, number> | null {
  const system = object(object(settings?.fantrax_settings)?.scoringSystem)
  if (!system || !Array.isArray(system.scoringCategorySettings)) return null
  const result = fantraxScoringRules({ scoringSystem: system } as unknown as FantraxLeagueInfo)
  return result.gaps.length || !result.rules.length ? null
    : Object.fromEntries(result.rules.map((rule) => [rule.stat_key, rule.points_value]))
}

/** Pure projection of stored native/imported league data; never assumes a 12-team NFL league. */
export function buildTradeLeagueContext(row: LeagueRow, teams: TeamRow[], userId: string): TradeLeagueContext {
  const settings = object(row.settings)
  const canonicalScoring = object(settings?.scoringSettings)
  const canonicalRoster = object(settings?.rosterSettings)
  const rawSlots = slotsFromArray(row.starters, row.sport)
    ?? slotsFromArray(settings?.roster_positions, row.sport)
  const canonicalSlots = slotsFromObject(canonicalRoster?.starterSlots)
  const starterSlots = Object.keys(canonicalSlots).length ? canonicalSlots : rawSlots?.starters ?? {}
  const importedNhlRules = row.platform === 'fantrax' && row.sport === 'NHL'
    ? fantraxNhlRules(settings) : undefined
  const details = importedNhlRules === undefined ? ruleDetails(canonicalScoring?.rulesDetail) : []
  const rules = numericRules(canonicalScoring?.rules)
  const nativeNhlRules = row.sport === 'NHL'
    ? numericRules(object(settings?.nhl_scoring_config)?.rules) : {}
  const scoringRules = importedNhlRules === null ? {}
    : importedNhlRules ?? (Object.keys(rules).length ? rules
      : Object.keys(nativeNhlRules).length ? nativeNhlRules : numericRules(settings?.scoring_settings))
  const categoryPresetId = typeof canonicalScoring?.categoryPresetId === 'string'
    ? canonicalScoring.categoryPresetId
    : null
  const teamCount = positiveInteger(row.leagueSize)
    ?? positiveInteger(settings?.team_count)
    ?? positiveInteger(settings?.total_rosters)
    ?? positiveInteger(teams.length)
  const mode = scoringMode(
    canonicalScoring?.scoringMode ?? settings?.scoring_mode ?? canonicalScoring?.format ?? row.scoring,
  )
  const mappedTeams = teams.map((team) => ({
    id: team.id,
    externalId: team.externalId,
    name: team.teamName,
    claimedByUserId: team.claimedByUserId,
    record: { wins: team.wins, losses: team.losses, ties: team.ties },
    rank: team.currentRank,
  }))
  const missing: TradeLeagueContext['missing'] = []
  if (teamCount === null) missing.push('team_count')
  if (Object.keys(scoringRules).length === 0 && details.length === 0 && !categoryPresetId) missing.push('scoring_rules')
  if (Object.keys(starterSlots).length === 0) missing.push('roster_slots')
  if (mappedTeams.length === 0) missing.push('teams')

  return {
    leagueId: row.id,
    platformLeagueId: row.platformLeagueId,
    name: row.name,
    platform: row.platform,
    sport: row.sport,
    season: row.season,
    format: row.leagueType,
    dynasty: row.isDynasty,
    teamCount,
    scoringMode: mode,
    categoryPresetId,
    scoringRules,
    scoringRuleDetails: details,
    starterSlots,
    benchSlots: nonNegativeInteger(canonicalRoster?.benchSlots) ?? rawSlots?.bench ?? null,
    irSlots: nonNegativeInteger(canonicalRoster?.irSlots) ?? nonNegativeInteger(row.irSlots) ?? rawSlots?.ir ?? null,
    taxiSlots: nonNegativeInteger(canonicalRoster?.taxiSlots) ?? nonNegativeInteger(row.taxiSlots) ?? rawSlots?.taxi ?? null,
    waiverBudget: nonNegativeInteger(object(settings?.waiverSettings)?.faabBudget) ?? nonNegativeInteger(row.waiverBudget),
    teams: mappedTeams,
    viewerTeamIds: mappedTeams.filter((team) => team.claimedByUserId === userId).map((team) => team.id),
    missing,
  }
}

