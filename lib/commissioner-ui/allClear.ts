import type { SeverityTier } from './tokens/colors'

/**
 * What an empty Commissioner OS list may say about the league.
 *
 * 🛑 AN EMPTY LIST IS NOT A CLEAN BILL OF HEALTH. Mission Control and League Health both printed
 * "Your league is in good shape" whenever their list came back empty — including when the list
 * could not be read at all (a failed read falls back to `[]`), and when league health itself was
 * unavailable. Seen 2026-10-01 in a signed-in check: "Your league is in good shape" directly under
 * a League Health card reading "Unavailable".
 *
 * So the all-clear needs two readings, and each missing one changes the sentence:
 *   - the list was not read      -> say so; "none" and "couldn't load" are different facts
 *   - league health has no reading -> report the empty list, make no claim about the league
 *   - league health is poor       -> report the empty list, and say the score disagrees
 * Only a read list AND a healthy-enough reading keep the original reassurance.
 */
export function allClearCopy(input: {
  /** The heading used when the list was read and is empty, e.g. "No active risks." */
  emptyTitle: string
  /** The reassurance, used only when both readings back it. */
  healthyDescription: string
  /** Lower-case noun for the list, for the couldn't-load case, e.g. "risks". */
  listName: string
  listRead: boolean
  /** The league-health tier, or null when there is no reading. */
  healthTier: SeverityTier | null
}): { title: string; description: string } {
  const { emptyTitle, healthyDescription, listName, listRead, healthTier } = input
  if (!listRead) {
    return {
      title: `Couldn’t load ${listName}.`,
      description: 'That isn’t the same as having none. Try again shortly.',
    }
  }
  if (healthTier === null) {
    return {
      title: emptyTitle,
      description: 'League health isn’t available yet, so this isn’t a verdict on the league.',
    }
  }
  if (healthTier === 'critical' || healthTier === 'elevated') {
    return {
      title: emptyTitle,
      description: `League health is ${healthTier === 'critical' ? 'critical' : 'elevated'}, so an empty list isn’t the whole picture.`,
    }
  }
  return { title: emptyTitle, description: healthyDescription }
}
