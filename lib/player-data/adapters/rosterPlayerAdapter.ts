/**
 * Roster board — merge normalized wire rows into existing roster player shapes (display-only).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { NflRedraftCanonicalPlayer } from '@/lib/player-data/nflRedraftCanonicalPlayer'
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

export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

/** Minimal row shape merged by id — matches useRosterManager `RosterPlayer` + optional enrichments */
export type RosterPlayerMergeable = {
  id: string
  name: string
  team: string
  position: string
  opponent: string
  gameTime: string
  projection: number
  actual: number | null
  status: 'healthy' | 'q' | 'out' | 'ir'
  slot: RosterSectionKey
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  providerInjuryLabel?: string | null
  unifiedProjectedPoints?: number | null
  unifiedLowConfidence?: boolean
  profileSource?: string | null
  statsSource?: string | null
  canonicalNflRedraft?: NflRedraftCanonicalPlayer | null
  canonicalPlayerMetadata?: NflRedraftPlayerDisplayMetadata | null
  canonicalPlayerIntelligence?: NflRedraftPlayerIntelligence | null
  canonicalGameContext?: NflRedraftGameContext | null
  canonicalLiveScoringContext?: NflRedraftLiveScoringContext | null
  providerGameStatus?: string | null
  providerLiveGameStatus?: string | null
  providerActualFantasyPoints?: number | null
  providerScoringRefreshTimestamp?: string | null
  providerMatchupRefreshTimestamp?: string | null
  providerStandingsRefreshRequired?: boolean
  providerStatCorrectionCount?: number
  providerWeatherSummary?: string | null
  playerDataLastUpdatedAt?: string | null
  playerDataWarnings?: string[]
}

export type RosterStateMergeable = Record<RosterSectionKey, RosterPlayerMergeable[]>

function enrichOne(p: RosterPlayerMergeable, byId: Map<string, UnifiedPlayerWireDto>): RosterPlayerMergeable {
  const u = byId.get(p.id)
  if (!u) return p
  const canonical = u.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(u)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(u)
  const gameContext = buildNflRedraftGameContextFromWire(u)
  const liveScoringContext = buildNflRedraftLiveScoringContextFromWire(u)
  const liveGameStatus = liveScoringContext?.gameStatus !== 'unknown' ? liveScoringContext?.gameStatus ?? null : null
  return {
    ...p,
    name: metadata?.displayName ?? canonical?.displayName ?? p.name,
    team: metadata?.teamAbbr ?? canonical?.teamAbbr ?? p.team,
    position: metadata?.position ?? canonical?.fantasyPosition ?? p.position,
    headshotUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? u.headshotUrl ?? null,
    teamLogoUrl: metadata?.teamLogo.url ?? canonical?.media.teamLogo.url ?? u.teamLogoUrl ?? null,
    opponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? p.opponent,
    gameTime: gameContext?.kickoffTimeIso ?? p.gameTime,
    actual: liveScoringContext?.actualFantasyPoints ?? liveScoringContext?.fantasyPoints ?? p.actual,
    providerInjuryLabel: intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? u.injuryStatus ?? null,
    unifiedProjectedPoints:
      liveScoringContext?.projectedFantasyPoints != null &&
      Number.isFinite(Number(liveScoringContext.projectedFantasyPoints))
        ? Number(liveScoringContext.projectedFantasyPoints)
      : intelligence?.projection.projectedFantasyPoints != null &&
      Number.isFinite(Number(intelligence.projection.projectedFantasyPoints))
        ? Number(intelligence.projection.projectedFantasyPoints)
        : canonical?.currentProjection.weeklyProjectedPoints != null &&
          Number.isFinite(Number(canonical.currentProjection.weeklyProjectedPoints))
          ? Number(canonical.currentProjection.weeklyProjectedPoints)
        : u.projectedPoints != null && Number.isFinite(Number(u.projectedPoints))
          ? Number(u.projectedPoints)
          : null,
    unifiedLowConfidence: u.lowConfidence === true || Boolean(canonical?.fallbacks.length) || Boolean(intelligence?.providerFallback.fallback),
    profileSource: u.profileSource ?? null,
    statsSource: u.statsSource ?? null,
    canonicalNflRedraft: canonical,
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    canonicalLiveScoringContext: liveScoringContext,
    providerGameStatus: liveGameStatus ?? gameContext?.gameStatus ?? null,
    providerLiveGameStatus: liveGameStatus,
    providerActualFantasyPoints: liveScoringContext?.actualFantasyPoints ?? liveScoringContext?.fantasyPoints ?? null,
    providerScoringRefreshTimestamp: liveScoringContext?.refresh.scoringRefreshTimestamp ?? null,
    providerMatchupRefreshTimestamp: liveScoringContext?.refresh.matchupRefreshTimestamp ?? null,
    providerStandingsRefreshRequired: liveScoringContext?.refresh.standingsRefreshRequired ?? false,
    providerStatCorrectionCount: liveScoringContext?.statCorrections.length ?? 0,
    providerWeatherSummary: formatWeatherSummary(gameContext),
    playerDataLastUpdatedAt: liveScoringContext?.providerFreshness.updatedAtIso ?? gameContext?.providerFreshness.updatedAtIso ?? intelligence?.providerFreshness.updatedAtIso ?? canonical?.lastUpdatedAt ?? null,
    playerDataWarnings: [
      ...(liveScoringContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.weatherFreshness.warnings ?? []),
      ...(intelligence?.providerFreshness.warnings ?? metadata?.providerFreshness.warnings ?? canonical?.dataFreshness.staleWarnings ?? []),
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

function mapSection(
  players: RosterPlayerMergeable[],
  byId: Map<string, UnifiedPlayerWireDto>,
): RosterPlayerMergeable[] {
  return players.map((p) => enrichOne(p, byId))
}

/**
 * Non-destructive: same ids/slots/order; adds unified fields when player id matches `unifiedRoster`.
 */
export function mergeUnifiedIntoRosterState<T extends RosterStateMergeable>(state: T, unifiedRoster: UnifiedPlayerWireDto[] | null | undefined): T {
  const byId = new Map<string, UnifiedPlayerWireDto>()
  for (const row of unifiedRoster ?? []) {
    if (row?.id) byId.set(String(row.id), row)
  }
  const sections: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  const out = { ...state }
  for (const key of sections) {
    out[key] = mapSection(state[key], byId) as T[typeof key]
  }
  return out
}
