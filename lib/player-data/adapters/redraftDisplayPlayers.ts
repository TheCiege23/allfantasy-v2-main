import type { PlayerMap, SlimPlayer } from '@/lib/hooks/useSleeperPlayers'
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
import { teamDefenseDisplayNameFromId } from '@/lib/redraft/teamDefenseIdentity'

export type DisplayPlayerRecord = SlimPlayer & {
  headshotUrl?: string | null
  imageUrl?: string | null
  teamLogoUrl?: string | null
  injuryStatus?: string | null
  projectedPoints?: number | null
  fantasyPointsPerGame?: number | null
  profileSource?: string | null
  statsSource?: string | null
  projectionsSource?: string | null
  byeWeek?: number | null
  activeStatus?: string | null
  opponent?: string | null
  homeAway?: string | null
  kickoffTimeIso?: string | null
  gameStatus?: string | null
  liveGameStatus?: string | null
  gameClock?: string | null
  actualFantasyPoints?: number | null
  scoringRefreshTimestamp?: string | null
  matchupRefreshTimestamp?: string | null
  standingsRefreshRequired?: boolean
  statCorrectionCount?: number
  weatherSummary?: string | null
  playerDataWarnings?: string[]
  canonicalNflRedraft?: NflRedraftCanonicalPlayer | null
  canonicalPlayerMetadata?: NflRedraftPlayerDisplayMetadata | null
  canonicalPlayerIntelligence?: NflRedraftPlayerIntelligence | null
  canonicalGameContext?: NflRedraftGameContext | null
  canonicalLiveScoringContext?: NflRedraftLiveScoringContext | null
}

export type DisplayPlayerMap = Record<string, DisplayPlayerRecord>

export function displayPlayerFromUnifiedRow(row: UnifiedPlayerWireDto): DisplayPlayerRecord {
  const canonical = row.nflRedraft ?? null
  const metadata = buildNflRedraftPlayerMetadataFromWire(row)
  const intelligence = buildNflRedraftPlayerIntelligenceFromWire(row)
  const gameContext = buildNflRedraftGameContextFromWire(row)
  const liveScoringContext = buildNflRedraftLiveScoringContextFromWire(row)
  const liveGameStatus = liveScoringContext?.gameStatus !== 'unknown' ? liveScoringContext?.gameStatus ?? null : null
  return {
    id: row.id,
    name: metadata?.displayName ?? row.name,
    position: metadata?.position ?? canonical?.fantasyPosition ?? row.position ?? '',
    team: metadata?.teamAbbr ?? canonical?.teamAbbr ?? row.team ?? 'FA',
    years_exp:
      canonical?.experience.years != null && Number.isFinite(Number(canonical.experience.years))
        ? Number(canonical.experience.years)
        : row.product?.yearsExp != null && Number.isFinite(Number(row.product.yearsExp))
          ? Number(row.product.yearsExp)
          : undefined,
    headshotUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? row.headshotUrl ?? null,
    imageUrl: metadata?.headshot.url ?? canonical?.media.headshot.url ?? row.imageUrl ?? row.headshotUrl ?? null,
    teamLogoUrl: metadata?.teamLogo.url ?? canonical?.media.teamLogo.url ?? row.teamLogoUrl ?? null,
    injuryStatus: intelligence?.injury.injuryStatus ?? canonical?.injury.designation ?? row.injuryStatus ?? null,
    projectedPoints:
      liveScoringContext?.projectedFantasyPoints != null &&
      Number.isFinite(Number(liveScoringContext.projectedFantasyPoints))
        ? Number(liveScoringContext.projectedFantasyPoints)
      : intelligence?.projection.projectedFantasyPoints != null &&
      Number.isFinite(Number(intelligence.projection.projectedFantasyPoints))
        ? Number(intelligence.projection.projectedFantasyPoints)
        : canonical?.currentProjection.weeklyProjectedPoints != null &&
          Number.isFinite(Number(canonical.currentProjection.weeklyProjectedPoints))
          ? Number(canonical.currentProjection.weeklyProjectedPoints)
        : row.projectedPoints != null && Number.isFinite(Number(row.projectedPoints))
          ? Number(row.projectedPoints)
          : null,
    fantasyPointsPerGame:
      row.fantasyPointsPerGame != null && Number.isFinite(Number(row.fantasyPointsPerGame))
        ? Number(row.fantasyPointsPerGame)
        : null,
    profileSource: row.profileSource ?? null,
    statsSource: row.statsSource ?? null,
    projectionsSource: row.projectionsSource ?? null,
    byeWeek: metadata?.byeWeek ?? canonical?.byeWeek ?? row.product?.byeWeek ?? null,
    activeStatus: metadata?.activeStatus ?? canonical?.activeStatus ?? null,
    opponent: gameContext?.isByeWeek ? 'BYE' : gameContext?.opponent.teamAbbr ?? null,
    homeAway: gameContext?.homeAway ?? null,
    kickoffTimeIso: gameContext?.kickoffTimeIso ?? null,
    gameStatus: liveGameStatus ?? gameContext?.gameStatus ?? null,
    liveGameStatus,
    gameClock: liveScoringContext?.gameClock.display ?? null,
    actualFantasyPoints: liveScoringContext?.actualFantasyPoints ?? liveScoringContext?.fantasyPoints ?? null,
    scoringRefreshTimestamp: liveScoringContext?.refresh.scoringRefreshTimestamp ?? null,
    matchupRefreshTimestamp: liveScoringContext?.refresh.matchupRefreshTimestamp ?? null,
    standingsRefreshRequired: liveScoringContext?.refresh.standingsRefreshRequired ?? false,
    statCorrectionCount: liveScoringContext?.statCorrections.length ?? 0,
    weatherSummary: formatWeatherSummary(gameContext),
    playerDataWarnings: [
      ...(liveScoringContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.providerFreshness.warnings ?? []),
      ...(gameContext?.weatherFreshness.warnings ?? []),
      ...(intelligence?.providerFreshness.warnings ?? metadata?.providerFreshness.warnings ?? canonical?.dataFreshness.staleWarnings ?? []),
    ],
    canonicalNflRedraft: canonical,
    canonicalPlayerMetadata: metadata,
    canonicalPlayerIntelligence: intelligence,
    canonicalGameContext: gameContext,
    canonicalLiveScoringContext: liveScoringContext,
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

export function buildDisplayPlayerMap(
  basePlayers: PlayerMap | null | undefined,
  unifiedRows: UnifiedPlayerWireDto[] | null | undefined,
): DisplayPlayerMap {
  const out: DisplayPlayerMap = { ...(basePlayers ?? {}) }
  for (const row of unifiedRows ?? []) {
    if (!row?.id) continue
    const existing = out[row.id]
    out[row.id] = {
      ...(existing ?? {}),
      ...displayPlayerFromUnifiedRow(row),
      espn_id: existing?.espn_id,
      nba_id: existing?.nba_id,
    }
  }
  return out
}

export function resolveDisplayPlayer(
  playerId: string,
  players: DisplayPlayerMap,
): DisplayPlayerRecord {
  const p = players[playerId]
  if (p) return p
  // No normalized-player entry (e.g. the foundation has no row for a synthetic
  // team-defense id). A `nfl:def:<TEAM>` id is self-describing, so derive a
  // readable name ("KC Defense") + DEF position from the id itself — reusable
  // across every league concept and surface. Any other unknown id stays a
  // neutral placeholder (never fabricate a real player's name).
  const teamDefName = teamDefenseDisplayNameFromId(playerId)
  if (teamDefName) {
    return { id: playerId, name: teamDefName, position: 'DEF', team: '' }
  }
  return {
    id: playerId,
    name: `Player ${playerId.slice(-4)}`,
    position: '',
    team: '',
  }
}

export function displayPlayersFromUnifiedRows(
  rows: UnifiedPlayerWireDto[] | null | undefined,
): DisplayPlayerRecord[] {
  return (rows ?? []).map(displayPlayerFromUnifiedRow)
}
