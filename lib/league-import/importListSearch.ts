/**
 * Search for the long lists on the import screen (leagues found, "which team is yours?").
 *
 * A 32-team league means scrolling 32 rows on a phone to find one name. Every word typed must
 * appear somewhere in the row's fields, in any order; accents and letter case are ignored.
 */

/** Lists this long or longer get a search box. Shorter ones fit on one phone screen. */
export const IMPORT_SEARCH_MIN_ROWS = 8

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function matchesImportSearch(query: string, fields: Array<string | number | null | undefined>): boolean {
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = fold(fields.filter((f) => f != null).join(' '))
  return words.every((w) => hay.includes(w))
}
