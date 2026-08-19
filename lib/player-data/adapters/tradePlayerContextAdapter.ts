/**
 * Trade evaluator — provider evidence only; internal trade value stays caller-owned.
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
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

export type TradePlayerEvidenceSlice = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  sport: string
  headshotUrl: string | null
  teamLogoUrl: string | null
  canonicalPlayerMetadata: NflRedraftPlayerDisplayMetadata | null
  canonicalPlayerIntelligence: NflRedraftPlayerIntelligence | null
  canonicalGameContext: NflRedraftGameContext | null
  injuryStatus: string | null
  adp: number | null
  aiAdp: number | null
  projectedPoints: number | null
  fantasyPointsPerGame: number | null
  profileSource: string | null
  statsSource: string | null
  projectionsSource: string | null
  opponent: string | null
  homeAway: string | null
  kickoffTimeIso: string | null
  gameStatus: string | null
  weatherSummary: string | null
  /** Attribution for injury/status row when present */
  injurySource: string | null
  /** Separate from AI ADP — pool ADP semantics */
  adpSource: string | null
  aiAdpSource: string | null
  experienceSource: string | null
  lowConfidence: boolean
  dataFallbacks: string[]
  staleDataWarnings: string[]
  canonicalLastUpdatedAt: string | null
  missingDataNote?: string
}

export function tradeEvidenceFromUnifiedWire(row: UnifiedPlayerWireDto): TradePlayerEvidenceSlice {
  const canonical = row.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(row)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(row)
  const gameContext = buildNflRedraftGameContextFromWire(row)
  const missing: string[] = []
  if (!metadata?.headshot.url && !canonical?.media.headshot.url && !row.headshotUrl) missing.push('image')
  if ((intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus) == null || String(intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus).trim() === '') missing.push('injury')
  if (!row.normalizedStats || Object.keys(row.normalizedStats).length <= 2) missing.push('stats')
  for (const field of canonical?.dataFreshness.missingFields ?? []) {
    if (!missing.includes(field)) missing.push(field)
  }
  const u = row.product?.unified as
    | {
        profileSource?: string | null
        adpSource?: string | null
        aiAdpSource?: string | null
        yearsExpSource?: string | null
        rookieSource?: string | null
      }
    | undefined
  const injuryPresent = (intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus) != null && String(intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus).trim() !== ''
  return {
    playerId: row.id,
    name: metadata?.displayName ?? row.name,
    position: metadata?.position ?? row.position,
    team: metadata?.teamAbbr ?? row.team,
    sport: row.sport,
    headshotUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? row.headshotUrl,
    teamLogoUrl: metadata?.teamLogo.url ?? canonical?.media.teamLogo.url ?? row.teamLogoUrl,
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    injuryStatus: intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus,
    adp: intelligence?.ranking.adp ?? row.adp,
    aiAdp: intelligence?.ranking.aiAdp ?? row.aiAdp,
    projectedPoints: intelligence?.projection.projectedFantasyPoints ?? canonical?.currentProjection.weeklyProjectedPoints ?? row.projectedPoints,
    fantasyPointsPerGame: row.fantasyPointsPerGame,
    profileSource: row.profileSource,
    statsSource: row.statsSource,
    projectionsSource: intelligence?.projection.source ?? row.projectionsSource,
    opponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? null,
    homeAway: gameContext?.homeAway ?? null,
    kickoffTimeIso: gameContext?.kickoffTimeIso ?? null,
    gameStatus: gameContext?.gameStatus ?? null,
    weatherSummary: formatWeatherSummary(gameContext),
    injurySource: injuryPresent ? intelligence?.injury.source ?? canonical?.injury.source ?? u?.profileSource ?? row.profileSource ?? null : null,
    adpSource: intelligence?.ranking.adp != null ? intelligence.ranking.adpSource ?? u?.adpSource ?? null : row.adp != null ? u?.adpSource ?? null : null,
    aiAdpSource: intelligence?.ranking.aiAdp != null ? u?.aiAdpSource ?? null : row.aiAdp != null ? u?.aiAdpSource ?? null : null,
    experienceSource: u?.yearsExpSource ?? u?.rookieSource ?? u?.profileSource ?? row.profileSource ?? null,
    lowConfidence: row.lowConfidence === true || Boolean(canonical?.fallbacks.length) || Boolean(intelligence?.providerFallback.fallback) || Boolean(gameContext?.providerFallback.fallback),
    dataFallbacks: [
      ...(intelligence?.providerFallback.fields ?? canonical?.fallbacks.map((fallback) => fallback.field) ?? []),
      ...(gameContext?.providerFallback.fields ?? []),
    ],
    staleDataWarnings: [
      ...(intelligence?.providerFreshness.warnings ?? canonical?.dataFreshness.staleWarnings ?? []),
      ...(gameContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.weatherFreshness.warnings ?? []),
    ],
    canonicalLastUpdatedAt: gameContext?.providerFreshness.updatedAtIso ?? intelligence?.providerFreshness.updatedAtIso ?? canonical?.lastUpdatedAt ?? null,
    missingDataNote: missing.length ? `missing: ${missing.join(', ')}` : undefined,
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

export function tradeEvidenceBlockForPrompt(rows: UnifiedPlayerWireDto[], label: string): string {
  if (!rows.length) return ''
  const lines = rows.map((r) => {
    const e = tradeEvidenceFromUnifiedWire(r)
    const bits = [
      `${e.name} (${e.position ?? '—'}, ${e.team ?? 'FA'})`,
      e.injuryStatus ? `injury=${e.injuryStatus}` : null,
      e.injurySource ? `injurySrc=${e.injurySource}` : null,
      e.adp != null ? `adp=${e.adp}` : null,
      e.adpSource ? `adpSrc=${e.adpSource}` : null,
      e.aiAdp != null ? `aiAdp=${e.aiAdp}` : null,
      e.aiAdpSource ? `aiAdpSrc=${e.aiAdpSource}` : null,
      e.statsSource ? `statsSrc=${e.statsSource}` : null,
      e.experienceSource ? `expSrc=${e.experienceSource}` : null,
      e.lowConfidence ? 'lowConfidence' : null,
      e.staleDataWarnings.length ? `stale=${e.staleDataWarnings.length}` : null,
      e.missingDataNote ?? null,
    ].filter(Boolean)
    return bits.join(' · ')
  })
  return `${label}:\n${lines.join('\n')}`
}
