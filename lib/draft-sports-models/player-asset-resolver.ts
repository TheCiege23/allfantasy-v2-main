/**
 * Resolve player headshot and team logo for draft UIs with fallbacks and cache.
 * Uses existing player-media and TeamLogoResolver; adds fallback URLs so no broken images.
 */

import type { DraftSport } from './types'
import { getPrimaryLogoUrlForTeam } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { buildPlayerMedia } from '@/lib/player-media'
import type { PlayerAssetModel, TeamDisplayModel } from './types'

const SLEEPER_NFL_HEADSHOT_BASE = 'https://sleepercdn.com/content/nfl/players/thumb'
const FALLBACK_HEADSHOT_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#1f2937"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="28" font-weight="700">AF</text></svg>'
)}`
const FALLBACK_TEAM_LOGO_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="#0f172a"/><rect x="10" y="10" width="76" height="76" rx="10" fill="#1e293b"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" fill="#93c5fd" font-family="Arial, sans-serif" font-size="24" font-weight="700">TM</text></svg>'
)}`

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const memoryCache = new Map<string, { data: PlayerAssetModel; expiresAt: number }>()

function cacheKey(playerId: string, teamAbbr: string | null, sport: string): string {
  return `assets:${sport}:${playerId}:${teamAbbr ?? ''}`
}

function sportToPlayerMediaSport(sport: string): string {
  const u = sport.toUpperCase()
  if (['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'].includes(u)) return u.toLowerCase()
  return 'nfl'
}

export type ResolvePlayerAssetsOpts = {
  /** DB / ingestion URL — highest precedence for headshot. */
  dbImageUrl?: string | null
  /** Only when set do we use Sleeper CDN / template headshot URLs (see `looksLikeSleeperExternalId`). */
  sleeperExternalId?: string | null
}

/**
 * Sleeper-style numeric external IDs — excludes UUIDs and synthetic `name:` keys.
 */
export function looksLikeSleeperExternalId(id: string | null | undefined): boolean {
  const t = String(id ?? '').trim()
  if (!t || t.includes(':')) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) return false
  return /^\d{3,}$/.test(t)
}

/**
 * Build team logo URL with static registry fallback (sync).
 */
export function resolveTeamLogoUrlSync(teamAbbreviation: string | null, sport: DraftSport | string): string | null {
  if (!teamAbbreviation?.trim()) return null
  return getPrimaryLogoUrlForTeam(sport, teamAbbreviation.trim())
}

/**
 * Sleeper CDN headshot for an NFL Sleeper id; `null` for every other sport.
 *
 * The NBA/MLB/NHL branches built Sleeper URLs from whatever id they were handed, and outside NFL
 * the draft pool hands them Rolling Insights ids — a different id space where a colliding number
 * is almost always somebody else. Those cards now use the stored image or initials.
 */
export function resolveHeadshotUrl(playerId: string | null, sport: string): string | null {
  if (!playerId) return null
  if (sport.toUpperCase() === 'NFL') return `${SLEEPER_NFL_HEADSHOT_BASE}/${playerId}.jpg`
  return null
}

/**
 * Resolve player assets (headshot + team logo) with fallbacks. Uses in-memory cache.
 * Headshot: DB `dbImageUrl` first, then Sleeper/template URLs only when `sleeperExternalId` is present.
 */
export function resolvePlayerAssets(
  playerId: string | null,
  teamAbbreviation: string | null,
  sport: DraftSport | string,
  opts?: ResolvePlayerAssetsOpts
): PlayerAssetModel {
  const dbUrl = opts?.dbImageUrl?.trim() || null
  const sleeperForCdn = opts?.sleeperExternalId?.trim() || null
  const key = cacheKey(`${playerId ?? ''}|${dbUrl ?? ''}|${sleeperForCdn ?? ''}`, teamAbbreviation, sport)
  const cached = memoryCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  let headshotUrl: string | null = dbUrl

  if (!headshotUrl && sleeperForCdn) {
    const media = buildPlayerMedia(sleeperForCdn, teamAbbreviation, sportToPlayerMediaSport(sport))
    headshotUrl = media.headshotUrl || resolveHeadshotUrl(sleeperForCdn, sport)
  }

  let teamLogoUrl: string | null = resolveTeamLogoUrlSync(teamAbbreviation, sport)
  if (sleeperForCdn) {
    const media = buildPlayerMedia(sleeperForCdn, teamAbbreviation, sportToPlayerMediaSport(sport))
    if (media.teamLogoUrl) teamLogoUrl = media.teamLogoUrl
  }

  const data: PlayerAssetModel = {
    headshotUrl: headshotUrl || FALLBACK_HEADSHOT_PLACEHOLDER,
    teamLogoUrl: teamLogoUrl || FALLBACK_TEAM_LOGO_PLACEHOLDER,
    headshotFallbackUrl: FALLBACK_HEADSHOT_PLACEHOLDER,
    teamLogoFallbackUrl: FALLBACK_TEAM_LOGO_PLACEHOLDER,
    headshotFallbackUsed: !headshotUrl,
    teamLogoFallbackUsed: !teamLogoUrl,
  }
  memoryCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
  return data
}

/**
 * Resolve assets for multiple players (batch; sync, cache per key).
 */
export function resolvePlayerAssetsBatch(
  items: Array<{ playerId: string | null; teamAbbreviation: string | null; sport: string; opts?: ResolvePlayerAssetsOpts }>
): Map<string, PlayerAssetModel> {
  const results = new Map<string, PlayerAssetModel>()
  for (const item of items) {
    const key = cacheKey(
      `${item.playerId ?? ''}|${item.opts?.dbImageUrl ?? ''}|${item.opts?.sleeperExternalId ?? ''}`,
      item.teamAbbreviation,
      item.sport
    )
    if (!results.has(key)) {
      const data = resolvePlayerAssets(item.playerId, item.teamAbbreviation, item.sport, item.opts)
      results.set(key, data)
    }
  }
  return results
}

/**
 * Build TeamDisplayModel from abbreviation and sport (logo from registry).
 */
export function buildTeamDisplayModel(
  teamAbbreviation: string | null,
  sport: DraftSport | string
): TeamDisplayModel | null {
  if (!teamAbbreviation?.trim()) return null
  const abbr = teamAbbreviation.trim().toUpperCase()
  const logoUrl = resolveTeamLogoUrlSync(abbr, sport)
  return {
    teamId: abbr,
    abbreviation: abbr,
    displayName: abbr,
    sport: sport as DraftSport,
    logoUrl,
    logoFallbackUsed: !logoUrl,
  }
}

export function clearAssetCache(): void {
  memoryCache.clear()
}
