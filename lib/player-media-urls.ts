/**
 * Template URL helpers for player/team media (no Prisma).
 * Keeps client bundles from importing lib/prisma via lib/player-media.ts.
 * Uses registry-only logo URLs — do not import TeamLogoResolver (it statically imports prisma).
 */

import type { SportType } from '@/lib/sport-teams/types'
import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'

function toSportType(s: string): SportType {
  const u = s.toUpperCase()
  if (u === 'NFL' || u === 'NBA' || u === 'MLB' || u === 'NHL' || u === 'NCAAF' || u === 'NCAAB' || u === 'SOCCER') {
    return u as SportType
  }
  return 'NFL'
}

const SLEEPER_NFL_HEADSHOT_BASE = 'https://sleepercdn.com/content/nfl/players/thumb'
const SLEEPER_NBA_HEADSHOT_BASE = 'https://sleepercdn.com/content/nba/players'
const SLEEPER_MLB_HEADSHOT_BASE = 'https://sleepercdn.com/content/mlb/players'
const SLEEPER_NHL_HEADSHOT_BASE = 'https://sleepercdn.com/content/nhl/players'
const ESPN_PLAYER_HEADSHOT_BASE = 'https://a.espncdn.com/i/headshots'

export type SportKey = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'ncaaf' | 'ncaab' | string

/** Team logo URL from the shared sport-team metadata registry. */
export function getTeamLogoUrl(teamAbbr: string | null, sport: string = 'nfl'): string | null {
  if (!teamAbbr) return null
  return getPrimaryLogoUrlForTeam(toSportType(sport), teamAbbr.trim())
}

export function buildHeadshotUrl(playerId: string | null): string | null {
  if (!playerId) return null
  // Team defenses use team codes (e.g. "PHI") — the players CDN 404s those, but
  // Sleeper serves them as team logos (mirrors lib/sports-data/headshots.ts).
  if (/^[A-Z]{2,3}$/.test(playerId)) {
    return `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`
  }
  return `${SLEEPER_NFL_HEADSHOT_BASE}/${playerId}.jpg`
}

/** Returns the best-known CDN headshot URL for a player ID by sport, or null if unsupported. */
export function sleeperHeadshotUrl(playerId: string, sport: SportKey = 'nfl'): string | null {
  if (!playerId) return null
  const s = String(sport).toLowerCase()
  if (s === 'nfl') return `${SLEEPER_NFL_HEADSHOT_BASE}/${playerId}.jpg`
  if (s === 'nba') return `${SLEEPER_NBA_HEADSHOT_BASE}/${playerId}.jpg`
  if (s === 'mlb') return `${SLEEPER_MLB_HEADSHOT_BASE}/${playerId}.jpg`
  if (s === 'nhl') return `${SLEEPER_NHL_HEADSHOT_BASE}/${playerId}.jpg`
  // NCAAF / NCAAB: ESPN player headshot (requires espn_id in future; skip for now)
  // Soccer: no reliable free CDN without sport-specific ID mapping
  return null
}

/** ESPN player headshot URL. Requires ESPN player ID (not Sleeper ID). */
export function espnPlayerHeadshotUrl(espnPlayerId: string | null | undefined, sport: SportKey = 'nfl'): string | null {
  if (!espnPlayerId) return null
  const s = String(sport).toLowerCase()
  const sportPath = s === 'nfl' ? 'nfl' : s === 'nba' ? 'nba' : s === 'mlb' ? 'mlb' : s === 'nhl' ? 'nhl' : null
  if (!sportPath) return null
  return `${ESPN_PLAYER_HEADSHOT_BASE}/${sportPath}/players/full/${espnPlayerId}.png`
}

export function sleeperTeamLogoUrl(teamAbbr: string, sport: SportKey = 'nfl'): string | null {
  if (!teamAbbr) return null
  return getTeamLogoUrl(teamAbbr, String(sport))
}

export function normalizeTeamAbbr(team?: string | null): string | null {
  const t = (team || '').trim()
  return t ? t.toUpperCase() : null
}
