/**
 * Demo league redactor — the SAFETY NET, not the anonymizer.
 *
 * The anonymizer (`buildDemoLeagueView`) is allowlist-based: it constructs every
 * outgoing field by hand from a fake alias, so a real name has to be copied in
 * deliberately to escape. This module is the second wall. It is handed every real
 * identifier the source league holds (team names, owner names, usernames, emails,
 * platform ids, the league's own name and provider id) and it:
 *
 *   1. replaces any occurrence in an outgoing payload with the matching alias, or a
 *      neutral placeholder when there is no alias, and
 *   2. counts what it replaced so the route can log THAT a leak was caught —
 *      never WHAT leaked. Logging the term would be the leak.
 *
 * ⚠ A REAL NAME CAN ALSO BE PART OF A PLAYER NAME. A manager called "Josh" must not
 * turn "Josh Allen" into "Demo Alex B. Allen". Terms that appear, whole-word, inside a
 * protected string (player names, NFL team names) are AMBIGUOUS: they are replaced
 * only where an entire string value equals them, never as a substring. That trades a
 * theoretical miss inside free text for not corrupting real player data, and the
 * ambiguous count is reported so the trade-off is visible rather than silent.
 */

export type SensitiveTerm = {
  /** The real value. Never logged, never returned. */
  value: string
  /** What to show instead. */
  replacement: string
}

export type RedactionStats = {
  replaced: number
  ambiguousTerms: number
}

/** Shorter terms are too likely to be ordinary words or initials; they are exact-match only. */
const MIN_SUBSTRING_TERM_LENGTH = 4

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function norm(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase()
}

export class DemoRedactor {
  private readonly exact = new Map<string, string>()
  private readonly substringTerms: Array<{ re: RegExp; replacement: string }> = []
  private readonly testTerms: Array<{ value: string; re: RegExp | null }> = []
  readonly stats: RedactionStats = { replaced: 0, ambiguousTerms: 0 }

  constructor(terms: SensitiveTerm[], protectedStrings: Iterable<string> = []) {
    const protectedNorm = Array.from(new Set(Array.from(protectedStrings, (p) => norm(p)).filter(Boolean)))

    // Longest first, so "Josh's Dynasty Squad" is replaced before "Josh".
    const unique = new Map<string, SensitiveTerm>()
    for (const t of terms) {
      const v = (t.value ?? '').trim()
      if (!v) continue
      const key = norm(v)
      if (!unique.has(key)) unique.set(key, { value: v, replacement: t.replacement })
    }
    const sorted = Array.from(unique.values()).sort((a, b) => b.value.length - a.value.length)

    for (const t of sorted) {
      const key = norm(t.value)
      this.exact.set(key, t.replacement)
      const wordRe = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(t.value)})(?=$|[^\\p{L}\\p{N}_])`, 'giu')
      const insideProtected = protectedNorm.some((p) => p !== key && new RegExp(wordRe.source, 'iu').test(p))
      const ambiguous = key.length < MIN_SUBSTRING_TERM_LENGTH || insideProtected
      if (ambiguous) {
        this.stats.ambiguousTerms += 1
        this.testTerms.push({ value: t.value, re: null })
        continue
      }
      this.substringTerms.push({ re: wordRe, replacement: t.replacement })
      this.testTerms.push({ value: t.value, re: new RegExp(wordRe.source, 'iu') })
    }
  }

  scrubString(input: string): string {
    if (!input) return input
    const whole = this.exact.get(norm(input))
    if (whole !== undefined) {
      this.stats.replaced += 1
      return whole
    }
    let out = input
    for (const { re, replacement } of this.substringTerms) {
      re.lastIndex = 0
      if (!re.test(out)) continue
      re.lastIndex = 0
      out = out.replace(re, (_m, pre: string) => {
        this.stats.replaced += 1
        return `${pre}${replacement}`
      })
    }
    return out
  }

  /** Deep copy with every string value AND object key scrubbed. */
  scrubDeep<T>(value: T): T {
    return this.walk(value, 0) as T
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 40) return null
    if (typeof value === 'string') return this.scrubString(value)
    if (Array.isArray(value)) return value.map((v) => this.walk(v, depth + 1))
    if (value instanceof Date) return value.toISOString()
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[this.scrubString(k)] = this.walk(v, depth + 1)
      }
      return out
    }
    return value
  }

  /**
   * How many distinct sensitive terms still appear in `text`. Used by the routes as a
   * last assertion before responding, and by the tests. Returns a COUNT only.
   */
  countLeaks(text: string): number {
    if (!text) return 0
    const lower = norm(text)
    let n = 0
    for (const t of this.testTerms) {
      if (t.re) {
        if (t.re.test(text)) n += 1
      } else if (lower === norm(t.value)) {
        n += 1
      } else if (new RegExp(`"${escapeRegExp(t.value)}"`, 'i').test(text)) {
        // An ambiguous term only counts when it is a whole JSON string value.
        n += 1
      }
    }
    return n
  }
}
