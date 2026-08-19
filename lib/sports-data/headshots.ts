/**
 * headshots — client-safe pure URL helpers for player/manager imagery.
 *
 * Sleeper's public CDN is the primary headshot source for every player id we
 * already carry (draft picks, rosters, projections all speak player_id).
 * Components should attach an onError fallback (hide, or swap to a TheSportsDB
 * cutout resolved via /api/players/assets) — the CDN 404s for some rookies and
 * most team defenses.
 */

export function sleeperPlayerHeadshot(playerId: string | null | undefined): string | null {
  if (!playerId) return null
  // Team defenses use team codes (e.g. "PHI") — Sleeper serves those as logos.
  if (/^[A-Z]{2,3}$/.test(playerId)) {
    return `https://sleepercdn.com/images/team_logos/nfl/${playerId.toLowerCase()}.png`
  }
  return `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`
}

export function sleeperAvatarThumb(avatarId: string | null | undefined): string | null {
  return avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null
}
