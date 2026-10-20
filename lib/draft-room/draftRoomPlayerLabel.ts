/**
 * The one answer to "which experience label does this draft-room player wear?" — every sport.
 *
 * - `prospect`: not yet a pro. Today that is an un-graduated college/devy row (NCAAF for NFL leagues,
 *   NCAAB for NBA ones). It wins over `rookie` because those rows are also flagged `isRookie` so the
 *   rookies-only filter admits them, and "Rookie" on a college freshman is the wrong word.
 * - `rookie`: an explicit rookie flag, or a known `yearsExp` of 0. Never inferred from a NULL.
 *
 * Pure and client-safe: the card and the board/queue chip both read it, so they cannot disagree.
 */
export type DraftRoomPlayerLabel = 'rookie' | 'prospect'

export type DraftRoomPlayerLabelInput = {
  isRookie?: boolean | null
  yearsExp?: number | null
  isDevy?: boolean | null
  graduatedToNFL?: boolean | null
  poolType?: string | null
}

export const DRAFT_ROOM_PLAYER_LABEL_TEXT: Record<DraftRoomPlayerLabel, string> = {
  rookie: 'Rookie',
  prospect: 'Prospect',
}

export function resolveDraftRoomPlayerLabel(
  player: DraftRoomPlayerLabelInput | null | undefined,
): DraftRoomPlayerLabel | null {
  if (!player) return null
  if (player.graduatedToNFL !== true && (player.isDevy === true || player.poolType === 'college')) {
    return 'prospect'
  }
  if (player.isRookie === true) return 'rookie'
  if (typeof player.yearsExp === 'number' && Number.isFinite(player.yearsExp) && player.yearsExp === 0) {
    return 'rookie'
  }
  return null
}
