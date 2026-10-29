/**
 * Waiver wire — preserve `UnifiedPlayerWireDto` and attach display / AI helpers.
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { PlayerDataAdapterFlags } from '@/lib/player-data/adapters/adapterTypes'
import {
  buildNflRedraftPlayerMetadataFromWire,
  type NflRedraftPlayerDisplayMetadata,
} from '@/lib/player-data/nflRedraftPlayerMetadata'
import {
  buildNflRedraftPlayerIntelligenceFromWire,
  type NflRedraftPlayerIntelligence,
} from '@/lib/player-data/nflRedraftPlayerIntelligence'
import {
  buildNflRedraftGameContextFromWire,
  type NflRedraftGameContext,
} from '@/lib/player-data/nflRedraftGameContext'
import { AF_FORM_PROJECTION_LABEL, AF_FORM_PROJECTION_SOURCE } from '@/lib/projections/dailySportFormLabels'

export type WaiverPlayerAdapted = UnifiedPlayerWireDto & {
  /** Convenience for rows/cards */
  displayHeadshotUrl: string | null
  displayTeamLogoUrl: string | null
  displayInjury: string | null
  displayStatus: string | null
  displayProjection: number | null
  displayAdp: number | null
  displayAiAdp: number | null
  displayByeWeek: number | null
  /** NBA / NHL / MLB: "C12" — rank within position by season points in the league's scoring. */
  displayPositionRank: string | null
  displayOpponent: string | null
  displayKickoffTime: string | null
  displayGameStatus: string | null
  displayWeatherSummary: string | null
  canonicalPlayerMetadata: NflRedraftPlayerDisplayMetadata | null
  canonicalPlayerIntelligence: NflRedraftPlayerIntelligence | null
  canonicalGameContext: NflRedraftGameContext | null
  projectionSourceLabel: string
  adpSourceLabel: string
  statsSourceLabel: string
  dataQualityLabels: string[]
  seasonStatsSummary: string[]
  experienceSummary: string | null
}

const EMPTY_VALUES = new Set(['', 'na', 'n/a', 'null', 'undefined', 'missing', 'unknown'])

function isUsableSource(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return !EMPTY_VALUES.has(normalized)
}

function experienceSummaryFromWire(p: UnifiedPlayerWireDto): string | null {
  const y = p.product?.yearsExp
  if (y != null && Number.isFinite(Number(y))) {
    const n = Number(y)
    if (n === 0) return 'Rookie'
    return `${n} YOE`
  }
  if (p.nflRookieIsRookie === true) return 'Rookie'
  return null
}

function formatSourceLabel(prefix: string, source: unknown, missingLabel: string): string {
  if (!isUsableSource(source)) return missingLabel
  const cleaned = source
    .trim()
    .replace(/^allfantasy:/i, 'AF ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
  return `${prefix}: ${cleaned}`
}

function formatNumber(value: unknown, digits = 1): string | null {
  // `Number(null)` is 0: without this, a missing fantasyPointsPerGame printed as "PPG 0".
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num.toFixed(digits).replace(/\.0$/, '')
}

/**
 * Season totals as `sports_players.stats` stores them (Rolling Insights vocabulary), per sport.
 * `perGame` divides by `games_played` — a basketball line reads per game, every other sport's
 * reads as a season total, which is how each sport's fans quote it.
 */
type HeadlineStat = { label: string; keys: string[]; perGame?: boolean; digits?: number }

const HEADLINE_STATS: Record<string, HeadlineStat[]> = {
  NFL: [
    { label: 'PASS YDS', keys: ['passing_yards'] },
    { label: 'RUSH YDS', keys: ['rushing_yards'] },
    { label: 'REC YDS', keys: ['receiving_yards'] },
    { label: 'TD', keys: ['passing_touchdowns', 'rushing_touchdowns', 'receiving_touchdowns'] },
    { label: 'REC', keys: ['receptions'] },
    { label: 'TKL', keys: ['tackles'] },
    { label: 'SACK', keys: ['sacks'] },
  ],
  NBA: [
    { label: 'PTS/G', keys: ['points'], perGame: true, digits: 1 },
    { label: 'REB/G', keys: ['total_rebounds'], perGame: true, digits: 1 },
    { label: 'AST/G', keys: ['assists'], perGame: true, digits: 1 },
  ],
  NHL: [
    { label: 'G', keys: ['goals'] },
    { label: 'A', keys: ['assists'] },
    { label: 'SOG', keys: ['shots_on_goal'] },
  ],
  MLB: [
    { label: 'HR', keys: ['batting.HR', 'Home Runs'] },
    { label: 'RBI', keys: ['batting.RBI', 'Runs Batted In'] },
    { label: 'SB', keys: ['batting.SB', 'Stolen Bases'] },
    { label: 'ERA', keys: ['pitching.ERA'], digits: 2 },
    { label: 'K', keys: ['pitching.K'] },
    { label: 'W', keys: ['pitching.W'] },
  ],
}

const GAMES_PLAYED_KEYS = ['games_played', 'Games Played']

/** The `sports_players.stats` keys the waiver line reads — the players route sends only these. */
export function pickWaiverHeadlineStats(stats: unknown): Record<string, unknown> {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return {}
  const src = stats as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const keys = new Set([...GAMES_PLAYED_KEYS, ...Object.values(HEADLINE_STATS).flatMap((l) => l.flatMap((s) => s.keys))])
  for (const key of keys) if (src[key] != null) out[key] = src[key]
  return out
}

function buildCacheStatsSummary(sport: string, stats: Record<string, unknown>, max: number): string[] {
  const lines = HEADLINE_STATS[sport.toUpperCase()]
  if (!lines || max <= 0) return []
  const num = (key: string): number | null => {
    const raw = stats[key]
    if (raw == null || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  const games = GAMES_PLAYED_KEYS.map(num).find((n) => n != null) ?? null
  const out: string[] = []
  for (const line of lines) {
    const parts = line.keys.map(num).filter((n): n is number => n != null)
    if (!parts.length) continue
    let value = parts.reduce((a, b) => a + b, 0)
    if (line.perGame) {
      if (games == null || games <= 0) continue
      value /= games
    }
    // A zero is not a headline: a QB's 0 receiving yards says nothing about him.
    if (value === 0) continue
    const formatted = formatNumber(value, line.digits ?? 0)
    if (formatted != null) out.push(`${line.label} ${formatted}`)
    if (out.length >= max) break
  }
  return out
}

function buildSeasonStatsSummary(stats: Record<string, unknown> | null | undefined, sport = ''): string[] {
  if (!stats || typeof stats !== 'object') return []
  const cache =
    stats.cacheStats && typeof stats.cacheStats === 'object' && !Array.isArray(stats.cacheStats)
      ? (stats.cacheStats as Record<string, unknown>)
      : null
  const candidates: Array<[string, string[]]> = [
    ['PPG', ['fantasyPointsPerGame', 'fantasy_points_per_game', 'pointsPerGame']],
    ['YDS', ['yards', 'totalYards', 'scrimmageYards', 'passingYards', 'rushingYards', 'receivingYards']],
    ['TD', ['touchdowns', 'totalTouchdowns', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns']],
    ['REC', ['receptions']],
  ]

  const summary: string[] = []
  for (const [label, keys] of candidates) {
    for (const key of keys) {
      const formatted = formatNumber(stats[key], label === 'PPG' ? 1 : 0)
      if (formatted != null) {
        summary.push(`${label} ${formatted}`)
        break
      }
    }
    if (summary.length >= 3) break
  }
  // `sports_players.stats` arrives nested under `cacheStats`, in the vendor's own key names.
  if (cache) summary.push(...buildCacheStatsSummary(sport, cache, 3 - summary.length))
  return summary
}

function buildDataQualityLabels(row: UnifiedPlayerWireDto): string[] {
  const labels: string[] = []
  const sport = String(row.sport ?? '').toUpperCase()
  const canonical = row.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(row)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(row)
  const gameContext = buildNflRedraftGameContextFromWire(row)
  if (row.adp != null) labels.push('Provider ADP')
  if (row.aiAdp != null) labels.push('AF ADP')
  else labels.push('AF ADP coming soon')
  if (intelligence?.projection.unavailable === false || canonical?.currentProjection.unavailable === false || row.projectedPoints != null) labels.push('Projection source')
  else labels.push('Fallback projection')
  if (
    canonical?.dataFreshness.stats === 'missing' ||
    (!isUsableSource(row.statsSource) && buildSeasonStatsSummary(row.normalizedStats, row.sport).length === 0)
  ) {
    labels.push('Missing stats')
  }
  if (canonical?.dataFreshness.media === 'missing' || metadata?.providerFallback.fields.includes('headshotUrl')) labels.push('Missing media')
  if (gameContext?.providerFallback.fields.includes('opponent')) labels.push('Missing schedule')
  if (gameContext?.providerFallback.fields.includes('weather')) labels.push('Missing weather')
  if (canonical?.dataFreshness.staleWarnings.length || metadata?.providerFreshness.stale || intelligence?.providerFreshness.stale || gameContext?.providerFreshness.stale || gameContext?.weatherFreshness.stale) labels.push('Stale provider data')
  if (row.lowConfidence || Boolean(canonical?.fallbacks.length) || metadata?.providerFallback.fallback || intelligence?.providerFallback.fallback || gameContext?.providerFallback.fallback) labels.push('Limited confidence')
  if (sport === 'NCAAF') labels.push('NCAAF limited data')
  return [...new Set(labels)]
}

export function adaptWaiverWirePlayer(
  row: UnifiedPlayerWireDto,
  _flags?: PlayerDataAdapterFlags,
): WaiverPlayerAdapted {
  const canonical = row.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(row)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(row)
  const gameContext = buildNflRedraftGameContextFromWire(row)
  const statsSummary = buildSeasonStatsSummary(row.normalizedStats, row.sport)
  return {
    ...row,
    displayHeadshotUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? row.headshotUrl ?? null,
    displayTeamLogoUrl: metadata?.teamLogo.url ?? canonical?.media.teamLogo.url ?? row.teamLogoUrl ?? null,
    displayInjury: intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus ?? null,
    displayStatus: canonical?.activeStatus ?? null,
    displayProjection:
      intelligence?.projection.projectedFantasyPoints != null &&
      Number.isFinite(Number(intelligence.projection.projectedFantasyPoints))
        ? Number(intelligence.projection.projectedFantasyPoints)
        : canonical?.currentProjection.weeklyProjectedPoints != null &&
          Number.isFinite(Number(canonical.currentProjection.weeklyProjectedPoints))
          ? Number(canonical.currentProjection.weeklyProjectedPoints)
        : row.projectedPoints != null && Number.isFinite(Number(row.projectedPoints))
          ? Number(row.projectedPoints)
          : null,
    displayAdp: intelligence?.ranking.adp != null && Number.isFinite(Number(intelligence.ranking.adp)) ? Number(intelligence.ranking.adp) : row.adp != null && Number.isFinite(Number(row.adp)) ? Number(row.adp) : null,
    displayAiAdp: intelligence?.ranking.aiAdp != null && Number.isFinite(Number(intelligence.ranking.aiAdp)) ? Number(intelligence.ranking.aiAdp) : row.aiAdp != null && Number.isFinite(Number(row.aiAdp)) ? Number(row.aiAdp) : null,
    displayByeWeek:
      metadata?.byeWeek != null && Number.isFinite(Number(metadata.byeWeek))
        ? Number(metadata.byeWeek)
        : canonical?.byeWeek != null && Number.isFinite(Number(canonical.byeWeek))
          ? Number(canonical.byeWeek)
          : row.product?.byeWeek != null && Number.isFinite(Number(row.product.byeWeek))
            ? Number(row.product.byeWeek)
            : null,
    displayPositionRank: row.positionRankLabel ?? null,
    displayOpponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? null,
    displayKickoffTime: gameContext?.kickoffTimeIso ?? null,
    displayGameStatus: gameContext?.gameStatus ?? null,
    displayWeatherSummary: formatWeatherSummary(gameContext),
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    // The daily-sport AF projection names itself exactly (dailySportForm.ts): it is recent form, not a feed.
    projectionSourceLabel:
      !intelligence && !canonical && row.projectionsSource === AF_FORM_PROJECTION_SOURCE
        ? AF_FORM_PROJECTION_LABEL
        : formatSourceLabel(
            'Projection',
            intelligence?.projection.source ?? canonical?.currentProjection.source ?? row.projectionsSource,
            'Fallback projection',
          ),
    adpSourceLabel: intelligence?.ranking.adp != null || row.adp != null ? 'Provider ADP' : 'Missing ADP',
    statsSourceLabel: formatSourceLabel('Stats', row.statsSource, 'Missing stats'),
    dataQualityLabels: buildDataQualityLabels(row),
    seasonStatsSummary: statsSummary,
    experienceSummary: experienceSummaryFromWire(row),
  }
}

function formatWeatherSummary(gameContext: NflRedraftGameContext | null): string | null {
  if (!gameContext || gameContext.weather.unavailable) return null
  const parts = [
    gameContext.weather.temperatureF != null ? `${Math.round(gameContext.weather.temperatureF)}F` : null,
    gameContext.weather.windSpeedMph != null ? `${Math.round(gameContext.weather.windSpeedMph)} mph wind` : null,
    gameContext.weather.precipitationType !== 'unknown' && gameContext.weather.precipitationType !== 'none'
      ? gameContext.weather.precipitationType
      : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' / ') : gameContext.weather.condition
}

export function adaptWaiverWirePlayerList(
  rows: UnifiedPlayerWireDto[],
  flags?: PlayerDataAdapterFlags,
): WaiverPlayerAdapted[] {
  return rows.map((r) => adaptWaiverWirePlayer(r, flags))
}
