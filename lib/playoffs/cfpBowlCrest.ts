/**
 * Which original AllFantasy crest a CFP game wears.
 *
 * The crests are our own artwork, not the bowls' official marks: no connected
 * provider carries bowl art (TheSportsDB GAPS R-15), and official bowl logos
 * are trademarks outside the headshot-only clearance in GAPS G-03.
 */
export type CfpBowlCrestKey = "rose" | "cotton" | "fiesta" | "peach" | "orange" | "sugar" | "title"

const BOWL_WORDS: Array<[RegExp, CfpBowlCrestKey]> = [
  [/\brose\b/i, "rose"],
  [/\bcotton\b/i, "cotton"],
  [/\bfiesta\b/i, "fiesta"],
  [/\bpeach\b/i, "peach"],
  [/\borange\b/i, "orange"],
  [/\bsugar\b/i, "sugar"],
  [/\bchampionship\b/i, "title"],
]

/** Crest for a game label such as "Rose Bowl" or "CFP National Championship"; null when no bowl is named. */
export function cfpBowlCrestKey(label: string | null | undefined): CfpBowlCrestKey | null {
  const text = label?.trim()
  if (!text) return null
  for (const [pattern, key] of BOWL_WORDS) if (pattern.test(text)) return key
  return null
}

export const CFP_BOWL_CREST_NAMES: Record<CfpBowlCrestKey, string> = {
  rose: "Rose Bowl",
  cotton: "Cotton Bowl",
  fiesta: "Fiesta Bowl",
  peach: "Peach Bowl",
  orange: "Orange Bowl",
  sugar: "Sugar Bowl",
  title: "National Championship",
}
