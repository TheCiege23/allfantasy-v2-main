/**
 * ESPN current-team headshots for NBA, NHL and MLB (owner decision 2026-11-27, contracts/espn GAPS E-08).
 *
 * TheSportsDB's cutouts are not updated after a trade — Darius Garland, traded CLE → LAC, still wore a
 * Cavaliers jersey on every AllFantasy surface — and no fresher photo was stored. ESPN's team rosters carry
 * a current headshot for nearly every player (19/19 LAC, 34/34 NYR, 38/39 NYY on 2026-11-27). The writer is
 * `lib/espn/proEspnHeadshotIngest.ts`; surfaces that choose between a player's stored rows prefer a row
 * carrying one of these over any other photo.
 *
 * Pure and client-safe: no fetch, no database.
 */

export const ESPN_PRO_HEADSHOT_SPORTS = ['NBA', 'NHL', 'MLB'] as const
export type EspnProSport = (typeof ESPN_PRO_HEADSHOT_SPORTS)[number]

/** ESPN site-API sport path per league (contracts/espn ENDPOINTS support_matrix). */
export const ESPN_PRO_SPORT_PATH: Record<EspnProSport, string> = {
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
}

export function isEspnProSport(sport: string | null | undefined): sport is EspnProSport {
  return (ESPN_PRO_HEADSHOT_SPORTS as readonly string[]).includes(String(sport ?? '').trim().toUpperCase())
}

/** `https://a.espncdn.com/i/headshots/{nba|nhl|mlb}/players/full/{id}.png` (contracts/espn headshot_cdn.pro_urls). */
const PRO_HEADSHOT = /^https:\/\/a\.espncdn\.com\/i\/headshots\/(nba|nhl|mlb)\/players\/full\/\d+\.png$/i

/** True for an ESPN pro-league headshot URL — for `sport` only, when one is given. */
export function isEspnProHeadshot(url: string | null | undefined, sport?: string | null): boolean {
  const m = PRO_HEADSHOT.exec(String(url ?? '').trim())
  if (!m) return false
  return sport ? m[1].toUpperCase() === String(sport).trim().toUpperCase() : true
}
