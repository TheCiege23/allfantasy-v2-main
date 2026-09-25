/**
 * How the Waivers screen names a league's tiebreak rule. Pure, with no imports, so the words can
 * be tested without the loader stack (lib/core-app/waivers.ts uses it).
 */

const TIEBREAK_LABEL: Record<string, string> = {
  faab: 'Highest FAAB bid',
  highest_bid: 'Highest FAAB bid',
  // Sleeper's own spelling — it reached the screen raw ("faab_highest") before this line.
  faab_highest: 'Highest FAAB bid',
  highest_faab: 'Highest FAAB bid',
  priority: 'Waiver priority order',
  waiver_order: 'Waiver priority order',
  reverse_standings: 'Reverse standings order',
  random: 'Random draw',
}

/**
 * A rule this map does not know yet, made readable rather than shown as a code: "earliest_claim"
 * → "Earliest claim". Still the league's own rule, word for word — only the underscores go.
 */
function humanizeRule(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw
}

/** The tiebreak rule as the Waivers screen says it. Never the raw code. */
export function describeTiebreakRule(raw: string): string {
  return TIEBREAK_LABEL[raw.trim().toLowerCase()] ?? humanizeRule(raw)
}
