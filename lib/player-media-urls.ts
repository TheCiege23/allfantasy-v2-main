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
const ESPN_PLAYER_HEADSHOT_BASE = 'https://a.espncdn.com/i/headshots'

export type SportKey = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'ncaaf' | 'ncaab' | string

/** Team logo URL from the shared sport-team metadata registry. */
export function getTeamLogoUrl(teamAbbr: string | null, sport: string = 'nfl'): string | null {
  if (!teamAbbr) return null
  return getPrimaryLogoUrlForTeam(toSportType(sport), teamAbbr.trim())
}

/**
 * Sleeper headshot URL for an NFL player id. Every other sport returns `null`.
 *
 * 🛑 It used to build the NFL URL whatever the sport. Outside NFL the ids reaching this function
 * are Rolling Insights ids, and the repo's own measurement found 42,031 of 42,032 of them that
 * collide with a Sleeper id belong to a DIFFERENT person — so an NBA or NHL card showed a stranger's
 * face, or a 404. A player without a stored image is shown with initials instead.
 */
export function buildHeadshotUrl(playerId: string | null, sport: string = 'nfl'): string | null {
  if (!playerId) return null
  if (String(sport).trim().toLowerCase() !== 'nfl') return null
  // Team defenses use team codes (e.g. "PHI") — the players CDN 404s those, but
  // Sleeper serves them as team logos (mirrors lib/sports-data/headshots.ts).
  if (/^[A-Z]{2,3}$/.test(playerId)) {
    return `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`
  }
  return `${SLEEPER_NFL_HEADSHOT_BASE}/${playerId}.jpg`
}

/**
 * Sleeper CDN headshot URL for an NFL player id. Every other sport returns `null`, as
 * `buildHeadshotUrl` above does.
 *
 * 🛑 IT BUILT NBA/MLB/NHL URLS TOO (2026-10-12), and the ids reaching it outside NFL are Rolling
 * Insights ids, not Sleeper's: a native NHL roster's 1114 is A.J. Greer, and Sleeper's NHL 1114 is
 * whoever Sleeper numbered that — a stranger's face on Chimmy's player cards and the draft board.
 * We hold Sleeper ids for NFL rows only (`mayBeSleeperId`), so there is no non-NFL id this could be
 * trusted with. The one caller reading genuine Sleeper NBA ids — the legacy trade analyzer, straight
 * from Sleeper's API through `lib/normalize-player.ts` — now shows no portrait in NBA mode.
 */
export function sleeperHeadshotUrl(playerId: string, sport: SportKey = 'nfl'): string | null {
  if (!playerId) return null
  if (String(sport).trim().toLowerCase() !== 'nfl') return null
  return `${SLEEPER_NFL_HEADSHOT_BASE}/${playerId}.jpg`
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
