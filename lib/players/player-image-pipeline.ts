/**
 * Player Image Pipeline — Phase 2
 *
 * Resolves the best available headshot URL for a player using a priority chain:
 *   1. Sleeper CDN (if sleeperId present and numeric)
 *   2. TheSportsDB (if thesportsdbId present and stored in record)
 *   3. API-Sports / SportsData (if apiSportsId present)
 *   4. Stored AllFantasy placeholder (per-position SVG with team logo backing)
 *
 * RULES:
 *   - Never overwrites a valid provider image (one that passes `isProviderImage`).
 *   - Only resolves images for players currently holding an AF placeholder or null.
 *   - Does NOT perform HTTP verification — returns CDN URLs that are well-known
 *     to be stable. Verification is left to the backfill script.
 *   - This module is side-effect-free and safe to import in any context.
 */

import { isProviderImage, isAfPlaceholderImage } from '@/lib/draft-room/player-canonical-identity'

type ImagePipelineInput = {
  sleeperId?: string | null
  thesportsdbId?: string | null
  apiSportsId?: string | null
  /** URL already on the record (may be null / placeholder). */
  existingImageUrl?: string | null
  sport?: string | null
  position?: string | null
  team?: string | null
  name?: string | null
}

type ImageResolution = {
  /** Resolved URL, or null if nothing found. */
  url: string | null
  /** Source that produced the URL. */
  source: 'sleeper' | 'thesportsdb' | 'api_sports' | 'team_logo' | 'none'
  /** True when the player already had a provider image and no change is needed. */
  unchanged: boolean
  /** True when we found a real provider URL (as opposed to team-logo fallback). */
  isRealHeadshot: boolean
}

/** Build the Sleeper CDN thumbnail URL for an NFL player. */
export function sleeperHeadshotUrl(sleeperId: string | null | undefined, sport: string | null | undefined = 'NFL'): string | null {
  const sid = String(sleeperId ?? '').trim()
  if (!sid || !/^\d+$/.test(sid) || sid.length < 2) return null
  const sp = (sport ?? 'NFL').toUpperCase()
  return `https://sleepercdn.com/content/${sp.toLowerCase()}/players/thumb/${sid}.jpg`
}

/** Build a TheSportsDB player cutout URL if a raw image path string is available. */
function thesportsdbHeadshotUrl(rawImagePath: string | null | undefined): string | null {
  if (!rawImagePath) return null
  const s = String(rawImagePath).trim()
  if (!s) return null
  // If it's already a full URL, return it
  if (/^https?:\/\//i.test(s)) return s
  return null
}

/** Build an API-Sports player headshot URL. */
export function apiSportsHeadshotUrl(apiSportsId: string | null | undefined, sport: string | null | undefined = 'NFL'): string | null {
  const id = String(apiSportsId ?? '').trim()
  if (!id || id.length < 1) return null
  const domainSport = (sport ?? 'NFL').toLowerCase() === 'nfl' ? 'american-football' : (sport ?? 'nfl').toLowerCase()
  return `https://media.api-sports.io/${domainSport}/players/${id}.png`
}

/** Team logo URL from ESPN CDN — used as last-resort for DEF or when no headshot found. */
function espnTeamLogoUrl(team: string | null | undefined, sport: string | null | undefined = 'NFL'): string | null {
  const t = String(team ?? '').trim().toLowerCase()
  if (!t) return null
  const sp = (sport ?? 'NFL').toLowerCase()
  return `https://a.espncdn.com/i/teamlogos/${sp}/500/${t}.png`
}

/**
 * Resolve the best available image for a player.
 *
 * The pipeline is intentionally fast (no network requests).
 * Pass `existingImageUrl` to allow the pipeline to short-circuit for players
 * that already have a valid provider image.
 */
export function resolvePlayerImage(input: ImagePipelineInput): ImageResolution {
  const existing = input.existingImageUrl ?? null

  // If the player already has a real provider image, return unchanged.
  if (isProviderImage(existing) && !isAfPlaceholderImage(existing)) {
    return { url: existing, source: 'none', unchanged: true, isRealHeadshot: true }
  }

  const sport = input.sport ?? 'NFL'

  // 1. Sleeper CDN
  const sleeperUrl = sleeperHeadshotUrl(input.sleeperId, sport)
  if (sleeperUrl) {
    return { url: sleeperUrl, source: 'sleeper', unchanged: false, isRealHeadshot: true }
  }

  // 2. TheSportsDB (stored image path)
  const tsdbUrl = thesportsdbHeadshotUrl(input.thesportsdbId)
  if (tsdbUrl) {
    return { url: tsdbUrl, source: 'thesportsdb', unchanged: false, isRealHeadshot: true }
  }

  // 3. API-Sports
  const apiSportsUrl = apiSportsHeadshotUrl(input.apiSportsId, sport)
  if (apiSportsUrl) {
    return { url: apiSportsUrl, source: 'api_sports', unchanged: false, isRealHeadshot: true }
  }

  // 4. Team logo fallback (only for DEF units or if we have a team)
  const pos = (input.position ?? '').toUpperCase()
  if (pos === 'DEF' || pos === 'DST' || pos === 'D/ST') {
    const logoUrl = espnTeamLogoUrl(input.team, sport)
    if (logoUrl) {
      return { url: logoUrl, source: 'team_logo', unchanged: false, isRealHeadshot: false }
    }
  }

  // No provider image found — keep existing (even if it's a placeholder)
  return { url: existing, source: 'none', unchanged: true, isRealHeadshot: false }
}

/**
 * Detects players within a pool that are sharing the same image URL
 * across different canonical identities (e.g. Deebo Samuel Sr. + Deebo Samuel).
 *
 * Returns a map of imageUrl → array of player ids/names that share it.
 * Only flags images that are shared across 2+ DISTINCT canonical players.
 * Sleeper CDN thumbs are excluded — the CDN returns the same numeric-keyed
 * image for each unique sleeperId, so two entries with the same Sleeper URL
 * would imply a data error already caught by the canonical dedup pass.
 */
export type ImageConflict = {
  imageUrl: string
  players: Array<{ id: string | null; name: string; position: string | null; team: string | null }>
}

export function detectSharedImages(
  players: Array<{
    id?: string | null
    name?: string | null
    position?: string | null
    team?: string | null
    imageUrl?: string | null
    sleeperId?: string | null
  }>,
): ImageConflict[] {
  const byUrl = new Map<string, typeof players>()

  for (const p of players) {
    const url = p.imageUrl?.trim()
    if (!url) continue
    // Skip data: URIs — all placeholders will "share" the same SVG
    if (url.startsWith('data:')) continue
    // Skip Sleeper CDN — unique per player by design
    if (/sleepercdn\.com\/content\//i.test(url)) continue
    const list = byUrl.get(url) ?? []
    list.push(p)
    byUrl.set(url, list)
  }

  const conflicts: ImageConflict[] = []
  for (const [url, group] of byUrl.entries()) {
    if (group.length < 2) continue
    conflicts.push({
      imageUrl: url,
      players: group.map((p) => ({
        id: p.id ?? null,
        name: p.name ?? '',
        position: p.position ?? null,
        team: p.team ?? null,
      })),
    })
  }

  return conflicts
}
