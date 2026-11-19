/**
 * Resolve headshot / team logo URLs for draft pick announcements from live player pool rows.
 */

import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

type PickAnnouncementAssets = {
  headshotUrl: string | null
  teamLogoUrl: string | null
}

export type RoundOneAnnouncementQueueItem = PickAnnouncementAssets & {
  id: string
  pick: DraftPickSnapshot
}

/**
 * Identity of a pick for "have we already announced this" — its seat on the board, never its row id.
 *
 * A Sleeper-mirrored draft (`lib/draft/sleeperSync.ts`) deletes and recreates EVERY `DraftPick` row
 * on each sync, so row ids churn every poll. Keyed on `id`, each poll looked like a fresh batch of
 * Round 1 picks and the room replayed up to four announcements, again and again, mid-draft.
 * `overall` is the seat; the player is included so a commissioner swapping the player in a
 * Round 1 cell is still announced once.
 */
export function roundOneAnnouncementKey(pick: Pick<DraftPickSnapshot, 'overall' | 'playerId' | 'playerName'>): string {
  const who = normalizeId(pick.playerId) ?? String(pick.playerName ?? '').trim().toLowerCase()
  return `${pick.overall}:${who}`
}

function normalizeId(id: string | null | undefined): string | null {
  if (!id || typeof id !== 'string') return null
  const t = id.trim()
  return t.length ? t : null
}

export function resolvePickAnnouncementAssets(
  pick: DraftPickSnapshot,
  players: PlayerEntry[],
): PickAnnouncementAssets {
  const persistedHeadshot = pick.playerImageUrl?.trim() || null

  const pid = normalizeId(pick.playerId)
  const match =
    (pid
      ? players.find((p) => {
          const dp = normalizeId(p.display?.playerId)
          return dp === pid || normalizeId(p.id) === pid
        })
      : undefined) ??
    players.find(
      (p) =>
        p.name === pick.playerName &&
        p.position === pick.position &&
        (p.team ?? null) === (pick.team ?? null),
    )

  const headshotUrl =
    persistedHeadshot ??
    match?.display?.assets?.headshotUrl ??
    match?.display?.assets?.headshotFallbackUrl ??
    null
  const teamLogoUrl =
    match?.display?.team?.logoUrl ??
    match?.display?.assets?.teamLogoUrl ??
    match?.display?.assets?.teamLogoFallbackUrl ??
    null

  return {
    headshotUrl: typeof headshotUrl === 'string' && headshotUrl.trim() ? headshotUrl.trim() : null,
    teamLogoUrl: typeof teamLogoUrl === 'string' && teamLogoUrl.trim() ? teamLogoUrl.trim() : null,
  }
}
