/**
 * Commissioner pick editor + board progress: "empty" pick rows (cleared slot, no renumbering).
 * Used by snapshot, submitPick, on-the-clock resolution, and finalization.
 */

export const PICK_EDITOR_EMPTY_POSITION = 'EMPTY'

export type DraftPickProgressRow = {
  overall: number
  playerName: string
  position: string
  pickMetadata?: unknown | null
}

export function isDraftPickRowEmpty(p: {
  playerName?: string | null
  position?: string | null
  pickMetadata?: unknown | null
}): boolean {
  const meta = p.pickMetadata as Record<string, unknown> | null | undefined
  if (meta && meta.pickEditorEmpty === true) return true
  if (String(p.position ?? '').toUpperCase() === PICK_EDITOR_EMPTY_POSITION && !String(p.playerName ?? '').trim()) {
    return true
  }
  return false
}

/**
 * A pick the clock SKIPPED (`autopick_behavior: 'skip'` writes `(Skipped)` / `SKIP`). It occupies
 * its overall — it is not an open pick, so `isDraftPickRowEmpty` stays false and the board moves
 * on — but it names no player, so no roster may receive it. Both post-draft roster syncs used to
 * put a "(Skipped)" player on the team.
 */
export function isDraftPickSkipped(p: { position?: string | null }): boolean {
  return String(p.position ?? '').trim().toUpperCase() === 'SKIP'
}

/** Client snapshot rows may set commissioner clear on `pickEditorEmpty` instead of JSON metadata only. */
export function isDraftPickRowEmptyFromSnapshot(p: {
  playerName?: string | null
  position?: string | null
  pickMetadata?: unknown | null
  pickEditorEmpty?: boolean | null
}): boolean {
  if (p.pickEditorEmpty === true) return true
  return isDraftPickRowEmpty(p)
}

/** Next overall in [1, totalPicks] with no row or an empty (cleared) row. Null when board is full. */
export function resolveNextOpenPickOverall(picks: DraftPickProgressRow[], totalPicks: number): number | null {
  if (totalPicks < 1) return null
  const byOverall = new Map(picks.map((p) => [p.overall, p]))
  for (let o = 1; o <= totalPicks; o++) {
    const row = byOverall.get(o)
    if (!row) return o
    if (isDraftPickRowEmpty(row)) return o
  }
  return null
}

export function isDraftBoardFull(picks: DraftPickProgressRow[], totalPicks: number): boolean {
  return resolveNextOpenPickOverall(picks, totalPicks) === null
}

export function countFilledDraftPicks(
  picks: Array<{ playerName: string; position: string; pickMetadata?: unknown | null }>,
): number {
  return picks.filter((p) => !isDraftPickRowEmpty(p)).length
}
