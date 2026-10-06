/**
 * lib/i18n/scoring-stats — Spanish for the stat names the scoring editors show.
 *
 * The category modules (`lib/nfl-scoring/NflScoringCategories.ts` and friends) are
 * imported by server code too — scoring metadata, the defaults registry, the layout —
 * so their English labels stay the source of truth and are never edited for a language.
 * Each sport family instead carries a table from the exact English label to its
 * Spanish, and an editor passes what it renders through `translateStat`.
 *
 * English is returned unchanged, so an English render is byte-identical to before. A
 * label with no entry also falls back to its English, so a stat added later reads in
 * English until it gets a row — each family's `__tests__/scoring-editors-<family>-i18n.test.tsx`
 * fails on that gap rather than letting it ship quietly.
 */

export type StatTable = Readonly<Record<string, string>>

export function translateStat(text: string, language: string, table: StatTable): string {
  if (language !== 'es') return text
  return table[text] ?? text
}
