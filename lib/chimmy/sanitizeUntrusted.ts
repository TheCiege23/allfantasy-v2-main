/**
 * Render an untrusted, non-catalog value as inert data for a prompt.
 *
 * 🛑 WHAT THIS CLAIMS, AND WHAT IT DOES NOT. This is CONTAINMENT, not a security
 * boundary. No string placed in a prompt can guarantee a model's behaviour, and
 * a claim that it can is false. What it guarantees is STRUCTURAL, and that part
 * is real: a value cannot close or forge the reference fence, cannot introduce a
 * line that reads as a new section or directive, and cannot be long enough to
 * bury the server-owned frame. The model's compliance on top of that is a
 * separate and weaker assurance, and should be described as one.
 *
 * The values that reach this are provider- and commissioner-controlled:
 * `keeperCostSystem` is a free string written by an importer or a settings form,
 * `sport` comes off the same row, and both are echoed into the prompt.
 *
 * ⚠ CATALOG TEXT IS NOT LAUNDERED THROUGH HERE. Summaries, phases and action
 * notes are version-controlled source the server authored; passing them through
 * would mangle their own punctuation to no benefit. Only values the server did
 * not write need this.
 *
 * 🛑 FILTERED BY CODE POINT, NOT BY A REGEX CHARACTER CLASS, AND THAT IS A
 * DELIBERATE CHOICE PAID FOR TWICE. Written as `/[\x00-\x1f]/` the class was
 * twice emitted as LITERAL control bytes — a real NUL landed in this source
 * file, `grep` reported it as binary, and a literal newline inside a regex
 * literal is a syntax error rather than a matcher. Comparing numbers cannot
 * fail that way: there is no escape sequence to mangle.
 */

/** Longest an untrusted value may be before it is truncated. */
export const MAX_UNTRUSTED_LEN = 120

/** Space. Everything below this is a C0 control character. */
const FIRST_PRINTABLE = 32
/** DEL. */
const DELETE_CHAR = 127
/** U+2028 LINE SEPARATOR. */
const LINE_SEPARATOR = 0x2028
/** U+2029 PARAGRAPH SEPARATOR. */
const PARAGRAPH_SEPARATOR = 0x2029

/**
 * True for any code point that can create a visual line break or is a control
 * character.
 *
 * ⚠ TAB (9) COUNTS AS REMOVABLE HERE even though it is not a line break: it is
 * used to fake indentation and so to fake structure, which is the same attack.
 */
function isStructural(code: number): boolean {
  if (code < FIRST_PRINTABLE) return true
  if (code === DELETE_CHAR) return true
  if (code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR) return true
  return false
}

export function sanitizeUntrusted(raw: unknown): string {
  if (raw === null || raw === undefined) return '(none)'
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '(invalid number)'
  if (typeof raw === 'boolean') return String(raw)

  /*
   * ⚠ A NON-PRIMITIVE IS DESCRIBED, NEVER SERIALIZED. `String({})` gives
   * "[object Object]"; `JSON.stringify` of a malformed or cyclic value can throw
   * outright, or emit a wall of text carrying its own quotes and newlines.
   * Neither belongs in a prompt, and neither is information a reader can use.
   */
  if (typeof raw !== 'string') return '(unreadable value)'

  /*
   * Structural characters become a single space rather than being deleted, so
   * two words either side of a forged newline do not silently fuse into one.
   */
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    out += isStructural(code) ? ' ' : ch
  }

  /*
   * Any run of '=' long enough to read as a fence, whatever text it wraps.
   * Matching the literal END marker alone would be defeated by one changed
   * character, so the SHAPE is neutralised rather than one exact string.
   */
  out = out.replace(/={4,}/g, '≡')

  // Collapse the runs the substitution above can leave behind.
  out = out.replace(/\s{2,}/g, ' ').trim()

  if (out.length > MAX_UNTRUSTED_LEN) {
    out = `${out.slice(0, MAX_UNTRUSTED_LEN)}… (truncated)`
  }
  return out.length > 0 ? out : '(empty)'
}
