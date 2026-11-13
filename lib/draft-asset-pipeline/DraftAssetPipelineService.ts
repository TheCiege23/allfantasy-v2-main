/**
 * Draft Asset Pipeline — single entry for all draft types (live, mock, auction, slow, keeper, devy, C2C).
 * Provides: asset normalization, asset cache, fallback placeholders, stat snapshot cache, team logo registry.
 * No provider-specific shapes leak to callers; all sports (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER) supported.
 */

import type { PlayerAssetModel, NormalizedDraftEntry, DraftSport } from '@/lib/draft-sports-models/types'
import type { RawDraftPlayerLike } from '@/lib/draft-sports-models/normalize-draft-player'
import { resolvePlayerAssets, resolveTeamLogoUrlSync } from '@/lib/draft-sports-models/player-asset-resolver'
import { normalizeDraftPlayer, normalizeDraftPlayerList } from '@/lib/draft-sports-models/normalize-draft-player'

/** Resolve player assets (headshot + team logo) with cache and fallbacks. */
export function resolveAssets(
  playerId: string | null,
  teamAbbreviation: string | null,
  sport: DraftSport | string
): PlayerAssetModel {
  return resolvePlayerAssets(playerId, teamAbbreviation, sport)
}

/** Get team logo URL from registry (sync). */
export function getTeamLogoUrl(teamAbbreviation: string | null, sport: DraftSport | string): string | null {
  return resolveTeamLogoUrlSync(teamAbbreviation, sport)
}

/** Normalize a single raw player into NormalizedDraftEntry (assets + stats + team from pipeline). */
export function normalizePlayer(raw: RawDraftPlayerLike, sport: DraftSport | string): NormalizedDraftEntry {
  return normalizeDraftPlayer(raw, sport)
}

/** Normalize a list of raw players (e.g. from ADP or player pool API). */
export function normalizePlayerList(
  rawList: RawDraftPlayerLike[],
  sport: DraftSport | string
): NormalizedDraftEntry[] {
  return normalizeDraftPlayerList(rawList, sport)
}

