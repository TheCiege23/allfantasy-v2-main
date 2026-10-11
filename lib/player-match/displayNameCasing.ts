/**
 * Display-name repair for player names that arrive mis-cased or shortened.
 *
 * Seen on /core/live 2026-10-11: "Jaxon Smith-njigba" (one vendor lower-cases the letter after a
 * hyphen) and play-by-play subjects named "A.St" / "S.La" (the vendor's short form of Amon-Ra
 * St. Brown and Sam LaPorta). Pure; display only — never a match key, which `normalizeMatchName` owns.
 */

/** Capitals at the start of each part: "Smith-Njigba" scores 2, "Smith-njigba" 1. */
export function casingScore(name: string): number {
  return name.split(/[\s\-'’]+/).filter((part) => /^[A-Z]/.test(part)).length
}

/**
 * Of two spellings of ONE name (equal ignoring case), the better-cased one; the first on a tie, so a
 * caller's existing choice only changes when the other is strictly better.
 */
export function betterCasedName(held: string, candidate: string): string {
  if (held.toLowerCase() !== candidate.toLowerCase()) return held
  return casingScore(candidate) > casingScore(held) ? candidate : held
}

/**
 * Capitalise a lowercase letter straight after a hyphen when the part before it is capitalised:
 * "Smith-njigba" → "Smith-Njigba". Hyphens only — a space may legitimately precede a lowercase
 * particle ("de", "van"), a hyphenated surname part may not.
 */
export function repairHyphenCasing(name: string): string {
  return name.replace(/(\b[A-Z][\p{L}'’.]*)-(\p{Ll})/gu, (_, before: string, letter: string) => `${before}-${letter.toUpperCase()}`)
}

/** "A.St", "S.La", "J. Smith": an initial and a dot, then a fragment. */
const SHORT_FORM = /^\p{Lu}\p{Ll}?\.\s?\S/u

/** True for a vendor short form ("A.St") — a name that cannot be looked up as a full name. */
export function isShortFormName(name: string): boolean {
  return SHORT_FORM.test(name.trim())
}

/**
 * The name to print for a play's subject, given the vendor's spelling and the canonical name of the
 * identity the play's own player id resolved to (null when it did not resolve).
 *
 * The canonical name is used only where the vendor's is a short form of the SAME person — an
 * initial-dot form, a bare surname the canonical name ends with, or a different casing. Two genuinely
 * different names keep the vendor's: the play is the primary record, and a disagreement is not ours to
 * settle here.
 */
export function displayPlayName(vendor: string, canonical: string | null | undefined): string {
  const v = vendor.trim()
  const c = canonical?.trim() || null
  if (c) {
    const vl = v.toLowerCase()
    const cl = c.toLowerCase()
    if (SHORT_FORM.test(v) || cl === vl || cl.endsWith(` ${vl}`)) {
      return repairHyphenCasing(cl === vl ? betterCasedName(v, c) : c)
    }
  }
  return repairHyphenCasing(v)
}
