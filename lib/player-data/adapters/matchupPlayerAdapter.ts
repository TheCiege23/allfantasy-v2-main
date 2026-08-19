/**
 * Start/sit / matchup cards — map unified wire rows to compact display context (no scoring engine).
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
import {
  buildNflRedraftLiveScoringContextFromWire,
  type NflRedraftLiveScoringContext,
} from '@/lib/player-data/nflRedraftLiveScoringContext'

export type MatchupPlayerCardContext = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  canonicalPlayerMetadata: NflRedraftPlayerDisplayMetadata | null
  canonicalPlayerIntelligence: NflRedraftPlayerIntelligence | null
  canonicalGameContext: NflRedraftGameContext | null
  canonicalLiveScoringContext: NflRedraftLiveScoringContext | null
  injuryStatus: string | null
  activeStatus: string | null
  opponent: string | null
  homeAway: string | null
  kickoffTimeIso: string | null
  gameStatus: string | null
  weatherSummary: string | null
  projectedPoints: number | null
  actualFantasyPoints: number | null
  liveGameStatus: string | null
  gameClock: string | null
  statCorrectionCount: number
  scoringRefreshTimestamp: string | null
  matchupRefreshTimestamp: string | null
  standingsRefreshRequired: boolean
  liveStatsAvailable: boolean
  statsSource: string | null
  projectionSource: string | null
  lowConfidence: boolean
  staleDataWarnings: string[]
}

export function matchupContextFromUnifiedWire(row: UnifiedPlayerWireDto): MatchupPlayerCardContext {
  const canonical = row.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(row)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(row)
  const gameContext = buildNflRedraftGameContextFromWire(row)
  const liveScoringContext = buildNflRedraftLiveScoringContextFromWire(row)
  const liveGameStatus = liveScoringContext?.gameStatus !== 'unknown' ? liveScoringContext?.gameStatus ?? null : null
  const stats = row.normalizedStats ?? {}
  const keys = Object.keys(stats).filter((k) => k !== 'projectionSource')
  return {
    playerId: row.id,
    name: metadata?.displayName ?? row.name,
    position: metadata?.position ?? canonical?.fantasyPosition ?? row.position,
    team: metadata?.teamAbbr ?? canonical?.teamAbbr ?? row.team,
    headshotUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? row.headshotUrl,
    teamLogoUrl: metadata?.teamLogo.url ?? canonical?.media.teamLogo.url ?? row.teamLogoUrl,
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    canonicalLiveScoringContext: liveScoringContext,
    injuryStatus: intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus,
    activeStatus: canonical?.activeStatus ?? null,
    opponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? null,
    homeAway: gameContext?.homeAway ?? null,
    kickoffTimeIso: gameContext?.kickoffTimeIso ?? null,
    gameStatus: liveGameStatus ?? gameContext?.gameStatus ?? null,
    weatherSummary: formatWeatherSummary(gameContext),
    projectedPoints: liveScoringContext?.projectedFantasyPoints ?? intelligence?.projection.projectedFantasyPoints ?? canonical?.currentProjection.weeklyProjectedPoints ?? row.projectedPoints,
    actualFantasyPoints: liveScoringContext?.actualFantasyPoints ?? liveScoringContext?.fantasyPoints ?? null,
    liveGameStatus,
    gameClock: liveScoringContext?.gameClock.display ?? null,
    statCorrectionCount: liveScoringContext?.statCorrections.length ?? 0,
    scoringRefreshTimestamp: liveScoringContext?.refresh.scoringRefreshTimestamp ?? null,
    matchupRefreshTimestamp: liveScoringContext?.refresh.matchupRefreshTimestamp ?? null,
    standingsRefreshRequired: liveScoringContext?.refresh.standingsRefreshRequired ?? false,
    liveStatsAvailable: (liveScoringContext?.stats.unavailable === false && Object.keys(liveScoringContext.stats.stats).length > 0) || keys.length > 2,
    statsSource: row.statsSource,
    projectionSource: intelligence?.projection.source ?? canonical?.currentProjection.source ?? row.projectionsSource,
    lowConfidence: row.lowConfidence === true || Boolean(canonical?.fallbacks.length) || Boolean(intelligence?.providerFallback.fallback) || Boolean(gameContext?.providerFallback.fallback),
    staleDataWarnings: [
      ...(intelligence?.providerFreshness.warnings ?? canonical?.dataFreshness.staleWarnings ?? []),
      ...(gameContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.weatherFreshness.warnings ?? []),
      ...(liveScoringContext?.providerFreshness.warnings ?? []),
    ],
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
