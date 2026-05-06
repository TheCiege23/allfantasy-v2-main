/**
 * Draft room display — prefer unified provider-fallback fields, then legacy row/display assets.
 * No invented stats; null-safe. ADP vs AI ADP stay distinct at call sites.
 */

import type { PlayerDisplayModel } from '@/lib/draft-sports-models/types'
import type { UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'

export type DraftRoomDisplayPlayerLike = {
  name?: string | null
  position?: string | null
  team?: string | null
  display?: PlayerDisplayModel | null
  unifiedProductView?: UnifiedPlayerProductView | null
  playerId?: string | null
  id?: string | null
  yearsExp?: number | null
  isRookie?: boolean
  adp?: number | null
  aiAdp?: number | null
  injuryStatus?: string | null
}

function trimHttpUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  const t = url.trim()
  if (!t || !/^https?:\/\//i.test(t)) return null
  return t
}

export function getDraftRoomDisplayName(player: DraftRoomDisplayPlayerLike | null | undefined): string {
  if (!player) return ''
  return (
    player.unifiedProductView?.unified.fullName?.trim() ||
    player.display?.displayName?.trim() ||
    String(player.name ?? '').trim() ||
    ''
  )
}

export function getDraftRoomDisplayTeam(player: DraftRoomDisplayPlayerLike | null | undefined): string | null {
  if (!player) return null
  const u = player.unifiedProductView?.unified
  const abbr = u?.teamAbbr ?? u?.team
  const fromDisplay = player.display?.metadata?.teamAbbreviation
  const raw = abbr ?? fromDisplay ?? player.team ?? null
  if (raw == null || String(raw).trim() === '') return null
  return String(raw).trim()
}

export function getDraftRoomDisplayPosition(player: DraftRoomDisplayPlayerLike | null | undefined): string {
  if (!player) return ''
  return (
    player.unifiedProductView?.unified.position?.trim() ||
    player.display?.metadata?.position?.trim() ||
    String(player.position ?? '').trim() ||
    ''
  )
}

export function getDraftRoomDisplayHeadshot(player: DraftRoomDisplayPlayerLike | null | undefined): string | null {
  if (!player) return null
  const u = player.unifiedProductView?.unified.headshotUrl
  const d = player.display?.assets?.headshotUrl ?? player.display?.assets?.headshotFallbackUrl
  return trimHttpUrl(u ?? d ?? null)
}

export function getDraftRoomDisplayInjury(player: DraftRoomDisplayPlayerLike | null | undefined): string | null {
  if (!player) return null
  const top = player.injuryStatus
  const u = player.unifiedProductView?.unified.injuryStatus ?? player.unifiedProductView?.injuryStatus
  const meta = player.display?.metadata?.injuryStatus
  const chain = [u, meta, top]
  for (const c of chain) {
    if (c != null && String(c).trim() !== '') return String(c).trim()
  }
  return null
}

/** Short label for chips — not a clinical diagnosis */
export function getDraftRoomDisplayExperienceBadge(player: DraftRoomDisplayPlayerLike | null | undefined): string | null {
  if (!player) return null
  const ye = player.yearsExp
  if (typeof ye === 'number' && Number.isFinite(ye)) {
    if (ye === 0) return 'Rookie'
    return `${ye} YOE`
  }
  if (player.isRookie === true) return 'Rookie'
  const exp = player.unifiedProductView?.unified.experience
  if (exp?.status === 'rookie' || exp?.rookie === true) return 'Rookie'
  if (
    exp?.status === 'veteran' &&
    typeof exp.proYears === 'number' &&
    exp.proYears > 0
  ) {
    return `${exp.proYears} YOE`
  }
  return null
}

export type DraftRoomProviderSources = {
  profile?: string | null
  stats?: string | null
  projections?: string | null
  image?: string | null
  adp?: string | null
  aiAdp?: string | null
  experience?: string | null
}

export function getDraftRoomDisplayProviderSources(
  player: DraftRoomDisplayPlayerLike | null | undefined,
): DraftRoomProviderSources | null {
  if (!player?.unifiedProductView) return null
  const u = player.unifiedProductView.unified
  return {
    profile: u.profileSource ?? null,
    stats: u.statsSource ?? null,
    projections: u.projectionsSource ?? null,
    image: u.imageSource ?? null,
    adp: u.adpSource ?? null,
    aiAdp: u.aiAdpSource ?? null,
    experience: u.yearsExpSource ?? u.rookieSource ?? null,
  }
}

export type BoardPickDisplayMerge = {
  playerImageUrl?: string | null
  injuryStatus?: string | null
  experienceBadge?: string | null
}

/**
 * Merge pool row onto a board cell pick for display only (does not change pick identity).
 */
export function mergePoolPlayerIntoBoardPickDisplay<T extends BoardPickDisplayMerge>(
  pick: T,
  pool?: DraftRoomDisplayPlayerLike | null,
): T {
  if (!pool) return pick
  const head = getDraftRoomDisplayHeadshot(pool)
  const inj = getDraftRoomDisplayInjury(pool)
  const badge = getDraftRoomDisplayExperienceBadge(pool)
  const prev = pick as BoardPickDisplayMerge
  return {
    ...pick,
    playerImageUrl: trimHttpUrl(head ?? undefined) ?? prev.playerImageUrl ?? null,
    injuryStatus: inj ?? prev.injuryStatus ?? null,
    experienceBadge: badge ?? prev.experienceBadge ?? null,
  }
}
