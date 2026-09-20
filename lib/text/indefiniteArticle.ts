/**
 * "a" or "an" for a label that is shown to a user.
 *
 * 🛑 THE RULE IS THE SOUND, NOT THE LETTER, AND EVERY SPORT IN THIS APP IS AN
 * EXCEPTION TO THE LETTER RULE. "MLB" begins with a consonant and takes "an",
 * because the letter M is said "em". The naive `/^[aeiou]/` test gets NFL,
 * NBA, NHL, MLB and NCAA all wrong — which is exactly what shipped: the create
 * page read "Build a MLB Playoff Challenge pool."
 *
 * ⚠ AND THE INVERSE EXISTS, so a rule of "initialisms always take an" is just
 * as wrong: "UFC" is said "you-ef-see" and takes "a". U is deliberately absent
 * from the vowel-SOUND set below for that reason.
 *
 * Scope: initialisms (read letter by letter) and ordinary words. It does not
 * attempt acronyms pronounced as words — "a UEFA final" is correct and this
 * returns "a UEFA" only because U is excluded; "an NCAA" is correct and this
 * gets it right. A label like "SEC" ("an SEC") works; one like "NASA"
 * ("a NASA") happens to work too. Anything relying on a pronunciation this
 * cannot see should pass its own article rather than grow a word list here.
 */

/**
 * Letters whose NAME starts with a vowel sound: A, E, F, H, I, L, M, N, O, R,
 * S, X. U is excluded ("you"), as are B, C, D, G, J, K, P, Q, T, V, W, Y, Z.
 */
const VOWEL_SOUND_LETTERS = new Set(["A", "E", "F", "H", "I", "L", "M", "N", "O", "R", "S", "X"])

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u"])

/** True when the first word reads letter by letter, e.g. "MLB", "NCAA Football". */
function startsWithInitialism(label: string): boolean {
  const first = label.trim().split(/\s+/)[0] ?? ""
  return first.length >= 2 && /^[A-Z]{2,}$/.test(first)
}

export function indefiniteArticleFor(label: string | null | undefined): "a" | "an" {
  const text = String(label ?? "").trim()
  if (!text) return "a"

  if (startsWithInitialism(text)) {
    return VOWEL_SOUND_LETTERS.has(text[0]) ? "an" : "a"
  }

  return VOWEL_LETTERS.has(text[0].toLowerCase()) ? "an" : "a"
}

/** `withIndefiniteArticle("MLB")` -> `"an MLB"`. */
export function withIndefiniteArticle(label: string | null | undefined): string {
  const text = String(label ?? "").trim()
  if (!text) return ""
  return `${indefiniteArticleFor(text)} ${text}`
}
