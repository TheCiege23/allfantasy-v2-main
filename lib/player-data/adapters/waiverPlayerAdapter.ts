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
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num.toFixed(digits).replace(/\.0$/, '')
}

function buildSeasonStatsSummary(stats: Record<string, unknown> | null | undefined): string[] {
  if (!stats || typeof stats !== 'object') return []
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
    (!isUsableSource(row.statsSource) && buildSeasonStatsSummary(row.normalizedStats).length === 0)
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
  const statsSummary = buildSeasonStatsSummary(row.normalizedStats)
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
    displayOpponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? null,
    displayKickoffTime: gameContext?.kickoffTimeIso ?? null,
    displayGameStatus: gameContext?.gameStatus ?? null,
    displayWeatherSummary: formatWeatherSummary(gameContext),
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    projectionSourceLabel: formatSourceLabel(
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
