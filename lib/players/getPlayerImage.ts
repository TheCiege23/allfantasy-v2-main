import type { NormalizedDraftRoomPlayer } from '@/lib/players/normalizePlayer'
import { looksLikeSleeperExternalId } from '@/lib/draft-sports-models/player-asset-resolver'
import { classifyAvatarSource } from '@/lib/draft-room/classify-avatar-source'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

export type PlayerImageSource = Pick<NormalizedDraftRoomPlayer, 'imageUrl' | 'name' | 'id'>

/**
 * Preferred headshot URL for UI, or null to trigger letter/initial fallback.
 * Ignores synthesized placeholders and team-logo URLs so a real Sleeper headshot
 * can still be derived from a numeric player id when available.
 */
export function getPlayerImage(player: PlayerImageSource, sportOverride?: string | null): string | null {
  const u = player.imageUrl?.trim()
  if (u && classifyAvatarSource(u) === 'headshot') return u
  const id = player.id?.trim()
  const sport = normalizeToSupportedSport(sportOverride ?? DEFAULT_SPORT)
  // Only an NFL draft-room id is a Sleeper id. A native NBA/NHL/MLB pool carries Rolling Insights
  // ids, which are numeric too, and a Sleeper URL built from one shows a different person.
  if (id && sport === 'NFL' && looksLikeSleeperExternalId(id)) {
    return sleeperHeadshotUrl(id, 'nfl')
  }
  return null
}

const preloaded = new Set<string>()

/**
 * Warm browser cache for visible rows (best-effort, no await).
 */
export function preloadPlayerImage(url: string | null | undefined): void {
  if (!url?.trim()) return
  const u = url.trim()
  if (preloaded.has(u)) return
  preloaded.add(u)
  if (typeof Image === 'undefined') return
  const img = new Image()
  img.src = u
}
