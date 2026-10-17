/**
 * Which league-format note makes a deal impossible, so the Trade Center leads with it and hides the
 * verdict. PURE AND BROWSER-SAFE: the server writes the note (`impossiblePickWarning`), the screen reads
 * it, and both take the phrase from here so the two cannot drift.
 *
 * 🛑 THE SCREEN USED TO MATCH `/cannot|does not exist|not a deal/` AGAINST THE FIRST NOTE (trade grade
 * audit, 2026-10-09). Informational notes say "cannot" too — Zombie leagues lead with "Zombie teams
 * cannot trade", the two-pick-pool note says "we cannot read which pool" — so every Zombie-league
 * verdict, and a C2C league's whenever that note led, was hidden as if the deal were impossible.
 * Only the impossible-pick warning blocks, and it carries this exact phrase.
 */
export const IMPOSSIBLE_PICK_MARKER = 'an asset that does not exist here'

export function isBlockingFormatNote(note: string | null | undefined): boolean {
  return typeof note === 'string' && note.includes(IMPOSSIBLE_PICK_MARKER)
}
