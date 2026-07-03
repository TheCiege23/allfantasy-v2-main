import type { PlayerMap, SlimPlayer } from '@/lib/hooks/useSleeperPlayers'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { NflRedraftCanonicalPlayer } from '@/lib/player-data/nflRedraftCanonicalPlayer'
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
  playerDataWarnings?: string[]
  canonicalNflRedraft?: NflRedraftCanonicalPlayer | null
}

export type DisplayPlayerMap = Record<string, DisplayPlayerRecord>

export function displayPlayerFromUnifiedRow(row: UnifiedPlayerWireDto): DisplayPlayerRecord {
  const canonical = row.nflRedraft ?? null
  return {
    id: row.id,
    name: row.name,
    position: canonical?.fantasyPosition ?? row.position ?? '',
    team: canonical?.teamAbbr ?? row.team ?? 'FA',
    years_exp:
      canonical?.experience.years != null && Number.isFinite(Number(canonical.experience.years))
        ? Number(canonical.experience.years)
        : row.product?.yearsExp != null && Number.isFinite(Number(row.product.yearsExp))
          ? Number(row.product.yearsExp)
          : undefined,
    headshotUrl: canonical?.media.headshot.url ?? row.headshotUrl ?? null,
    imageUrl: canonical?.media.headshot.url ?? row.imageUrl ?? row.headshotUrl ?? null,
    teamLogoUrl: canonical?.media.teamLogo.url ?? row.teamLogoUrl ?? null,
    injuryStatus: canonical?.injury.designation ?? row.injuryStatus ?? null,
    projectedPoints:
      canonical?.currentProjection.weeklyProjectedPoints != null &&
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
    byeWeek: canonical?.byeWeek ?? row.product?.byeWeek ?? null,
    activeStatus: canonical?.activeStatus ?? null,
    playerDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
    canonicalNflRedraft: canonical,
  }
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
