/**
 * Who may know which manager is the Whisperer — one rule for every surface.
 *
 * A league configured as secret (`ZombieLeague.whispererIsPublic === false`) keeps the identity
 * hidden even when its WhispererRecord says revealed: `selectWhisperer` never sets
 * `isPubliclyRevealed`, so that column is `true` on every record and cannot be trusted alone.
 * The head commissioner and the Whisperer themselves always know.
 *
 * Matches the league home page (`whispererIsPublic && (whispererRecord?.isPubliclyRevealed ?? true)`),
 * plus the commissioner and self exceptions. Unknown settings fail closed.
 *
 * Pure and client-safe.
 */
export function canViewerSeeWhisperer(input: {
  whispererIsPublic: boolean | null | undefined
  /** Null/undefined when the league has no WhispererRecord. */
  isPubliclyRevealed: boolean | null | undefined
  viewerIsCommissioner: boolean
  viewerIsWhisperer: boolean
}): boolean {
  if (input.viewerIsCommissioner || input.viewerIsWhisperer) return true
  if (input.whispererIsPublic !== true) return false
  return input.isPubliclyRevealed ?? true
}
