/**
 * Team logo URLs by abbreviation + sport (public CDNs).
 *
 * Rolling Insights logos (DataFeeds GraphQL, server credentials): use
 * `getRITeamLogoUrl` from `@/lib/players/ri-team-logos-server` in RSC/API routes only.
 */

import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { isKnownDeadLogoGuess, liveLogoOrNull } from '@/lib/sport-teams/knownDeadLogoGuess'
import type { SportType } from '@/lib/sport-teams/types'

/** NBA Stats API / cdn.nba.com numeric team ids */
export const NBA_TEAM_IDS: Record<string, number> = {
  ATL: 1610612737,
  BOS: 1610612738,
  BKN: 1610612751,
  CHA: 1610612766,
  CHI: 1610612741,
  CLE: 1610612739,
  DAL: 1610612742,
  DEN: 1610612743,
  DET: 1610612765,
  GSW: 1610612744,
  HOU: 1610612745,
  IND: 1610612754,
  LAC: 1610612746,
  LAL: 1610612747,
  MEM: 1610612763,
  MIA: 1610612748,
  MIL: 1610612749,
  MIN: 1610612750,
  NOP: 1610612740,
  NYK: 1610612752,
  OKC: 1610612760,
  ORL: 1610612753,
  PHI: 1610612755,
  PHX: 1610612756,
  POR: 1610612757,
  SAC: 1610612758,
  SAS: 1610612759,
  TOR: 1610612761,
  UTA: 1610612762,
  WAS: 1610612764,
}

/** MLB Static / team-logos numeric ids */
export const MLB_TEAM_IDS: Record<string, number> = {
  ARI: 109,
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CWS: 145,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC: 118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  OAK: 133,
  PHI: 143,
  PIT: 134,
  SD: 135,
  SEA: 136,
  SF: 137,
  STL: 138,
  TB: 139,
  TEX: 140,
  TOR: 141,
  WSH: 120,
}

/** ESPN `teamlogos/{segment}/500/{id}.png` path segment */
export const SPORT_TO_ESPN_TEAMLOGO: Record<string, string> = {
  NFL: 'nfl',
  NBA: 'nba',
  MLB: 'mlb',
  NHL: 'nhl',
  NCAAFB: 'ncaa',
  NCAABB: 'ncaa',
  SOCCER: 'soccer',
}

/**
 * Our sport spellings, collapsed. `NCAAFB`/`NCAABB` are the Rolling Insights codes for the same two
 * college sports, and used to fall through to NFL here, which asked the NFL CDN for a school.
 */
function toSportType(s: string): SportType | null {
  const u = String(s ?? '').trim().toUpperCase()
  if (u === 'NFL' || u === 'NBA' || u === 'MLB' || u === 'NHL' || u === 'NCAAF' || u === 'NCAAB' || u === 'SOCCER') {
    return u as SportType
  }
  if (u === 'NCAAFB') return 'NCAAF'
  if (u === 'NCAABB') return 'NCAAB'
  if (u === 'EPL' || u === 'MLS') return 'SOCCER'
  return null
}

/**
 * College and soccer crests cannot be built from a team string: ESPN keys them by numeric id, so
 * every guessed URL 404s (see `lib/sport-teams/knownDeadLogoGuess.ts`). For those sports the only
 * real logo is one a caller passes in — stored server-side and handed to `TeamLogo` as `logoUrl`.
 */
function isGuessless(sport: SportType | null): boolean {
  return sport === 'NCAAF' || sport === 'NCAAB' || sport === 'SOCCER'
}

/** "Not a team" — no crest exists for it, so nothing should be requested. */
export function isNoTeam(teamAbbr: string | null | undefined): boolean {
  const t = String(teamAbbr ?? '').trim().toUpperCase()
  return !t || t === 'FA' || t === 'F/A' || t === 'FREE AGENT' || t === 'N/A' || t === '—' || t === '-'
}

/**
 * Best GUESSED logo for a team string, or null when a guess cannot work. Never a placeholder
 * image: a placeholder is a real image, so it hid `TeamLogo`'s initials fallback behind a generic
 * avatar for every college and soccer team.
 */
export function getTeamLogoUrl(teamAbbr: string, sport: string): string | null {
  if (isNoTeam(teamAbbr)) return null
  const sportType = toSportType(sport)
  if (!sportType || isGuessless(sportType)) return null
  // The registry may return null for a non-team, and otherwise an ESPN-style guess.
  const primaryFromRegistry = liveLogoOrNull(getPrimaryLogoUrlForTeam(sportType, teamAbbr.trim()))
  if (primaryFromRegistry) return primaryFromRegistry

  const abbr = teamAbbr.toUpperCase()
  const s = sportType

  if (s === 'NFL') {
    return `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png`
  }
  if (s === 'NBA') {
    const id = NBA_TEAM_IDS[abbr]
    if (id) return `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`
    return `https://a.espncdn.com/i/teamlogos/nba/500/${teamAbbr.toLowerCase()}.png`
  }
  if (s === 'MLB') {
    const id = MLB_TEAM_IDS[abbr]
    if (id) return `https://www.mlbstatic.com/team-logos/${id}.svg`
    return `https://a.espncdn.com/i/teamlogos/mlb/500/${teamAbbr.toLowerCase()}.png`
  }
  if (s === 'NHL') {
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${teamAbbr.toLowerCase()}.png`
  }
  return null
}

/**
 * Ordered GUESSED URLs for `<img onError>` fallback chains — possibly empty. An empty list means
 * "no guess can work": `TeamLogo` then shows the caller's `logoUrl` if any, else initials.
 */
export function getTeamLogoCandidates(teamAbbr: string, sport: string): string[] {
  if (isNoTeam(teamAbbr)) return []
  const sportType = toSportType(sport)
  if (!sportType || isGuessless(sportType)) return []
  const primary = getTeamLogoUrl(teamAbbr, sport)
  const s = sportType
  const lower = teamAbbr.toLowerCase()
  const extra: string[] = []

  const espnSeg = SPORT_TO_ESPN_TEAMLOGO[s]
  if (espnSeg) {
    extra.push(`https://a.espncdn.com/i/teamlogos/${espnSeg}/500/${lower}.png`)
  }
  if (s === 'NFL') {
    extra.push(`https://a.espncdn.com/i/teamlogos/nfl/500/${lower}.png`)
    // Legacy/deep fallback only. Primary NFL path is DB/teamAsset -> ESPN/static.
    extra.push(`https://sleepercdn.com/images/team_logos/nfl/${lower}.png`)
    extra.push(`https://sleepercdn.com/images/team_logos/nfl/${lower}.jpg`)
  }
  if (s === 'NBA') {
    const id = NBA_TEAM_IDS[teamAbbr.toUpperCase()]
    if (id) {
      extra.push(`https://a.espncdn.com/i/teamlogos/nba/500/${lower}.png`)
    }
  }

  const merged = [primary, ...extra].filter((u): u is string => !!u && !isKnownDeadLogoGuess(u))
  return [...new Set(merged)]
}
