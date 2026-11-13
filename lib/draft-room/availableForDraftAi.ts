import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

/** Align with draft session pick list normalization (lowercase trim). */
export function normalizeDraftedPlayerName(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
}

/**
 * Exclude players already taken using name set and optional stable pick playerIds from session.
 */
function isPlayerAvailableForDraftAi(
  p: PlayerEntry,
  draftedNames: ReadonlySet<string>,
  draftedPlayerIds?: ReadonlySet<string> | null,
): boolean {
  const ids = draftedPlayerIds
  if (ids && ids.size > 0) {
    const pid =
      (p.display?.playerId != null ? String(p.display.playerId).trim() : '') ||
      (p.id != null ? String(p.id).trim() : '')
    if (pid && ids.has(pid)) return false
  }
  return !draftedNames.has(normalizeDraftedPlayerName(p.name))
}

export function filterPlayersAvailableForDraftAi(
  players: PlayerEntry[],
  draftedNames: ReadonlySet<string>,
  draftedPlayerIds?: ReadonlySet<string> | null,
): PlayerEntry[] {
  return players.filter((p) => isPlayerAvailableForDraftAi(p, draftedNames, draftedPlayerIds))
}
