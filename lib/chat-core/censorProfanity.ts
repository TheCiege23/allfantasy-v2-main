/**
 * SWEARING, RENDERED AS COMIC-STRIP SYMBOLS.
 *
 * ⚠ THIS RUNS AT RENDER, NOT AT WRITE. The stored message keeps the words
 * somebody actually typed. Censoring on the way into the database would be
 * irreversible, would make the filter impossible to turn off later, and would
 * mean a false positive silently destroyed part of a real message — and this
 * data is quoted back at people in trade arguments.
 *
 * ⚠ THE MASK IS DETERMINISTIC, AND THAT IS NOT COSMETIC. League chat re-fetches
 * every four to eight seconds. A mask built from anything random would draw a
 * different run of symbols on every poll, so the message would shimmer while it
 * sat on screen. The same word always renders the same way.
 *
 * ⚠ WHOLE WORDS ONLY. Substring matching is how a filter mangles "class",
 * "grass", "assist", "Scunthorpe" and "Dickerson" — a real surname in a league
 * full of player names. Every pattern here is anchored to word boundaries, and
 * the tests pin the innocent cases.
 */

/** Cycled by position so the run reads as comic-strip swearing rather than a bar. */
const SYMBOLS = ['!', '@', '#', '$', '%', '&']

/**
 * Base words. Kept deliberately short: a long list is a long list of false
 * positives, and the common cases are what a league chat actually produces.
 * Suffixes are handled by the pattern, so no plural or -ing forms belong here.
 */
const BASE_WORDS = [
  'fuck',
  'shit',
  'bitch',
  'bastard',
  'asshole',
  'dickhead',
  'cunt',
  'wanker',
  'prick',
  'douche',
  'twat',
  'slut',
  'whore',
  'piss',
  'crap',
  'damn',
  'dumbass',
  'jackass',
  'motherfucker',
]

/*
 * Suffixes a swear takes without becoming a different word. Anchoring with \b on
 * both sides keeps "assist" and "classy" out of it.
 */
const SUFFIX = '(?:s|es|ed|er|ers|ing|in|in\'|y|ies)?'

/*
 * ⚠ THE SOURCE IS SHARED; THE REGEX OBJECT IS NOT. A single module-level regex
 * with the `g` flag carries `lastIndex` between calls, so a second `test()` of
 * the same string starts partway through it and returns false. That is a real
 * bug and not a theoretical one — it is exactly what this module did first, and
 * the effect is a filter that censors a word once and then stops noticing it.
 * Building the regex per call keeps the module free of mutable state.
 */
/*
 * \\b and not \b: inside a template literal \b is the BACKSPACE
 * character (U+0008), so the pattern would hunt for a control code instead of a
 * word boundary and match nothing whatsoever. The filter silently passed every
 * message through untouched, and every test that asserted a censored result
 * failed at once.
 */
const PATTERN_SOURCE = `\\b(${BASE_WORDS.join('|')})${SUFFIX}\\b`

/**
 * The symbol run standing in for a word, after its first letter.
 *
 * Seeded from the word itself, so the same word always masks identically — see
 * the note above about polling.
 */
function maskFor(word: string): string {
  let out = ''
  for (let i = 1; i < word.length; i += 1) {
    /*
     * Character code plus position: two different words of the same length get
     * different runs, and the same word is always identical to itself.
     */
    const pick = (word.charCodeAt(i) + i) % SYMBOLS.length
    out += SYMBOLS[pick]
  }
  return out
}

/**
 * Replace swearing in a message with its first letter and a run of symbols.
 *
 * Returns the input unchanged when there is nothing to censor, so an ordinary
 * message is not rebuilt on every render.
 */
export function censorProfanity(text: string): string {
  if (!text) return text
  if (!hasProfanity(text)) return text
  return text.replace(
    new RegExp(PATTERN_SOURCE, 'gi'),
    (match) => `${match[0]}${maskFor(match)}`,
  )
}

/** Whether a message contains anything this would censor. */
export function hasProfanity(text: string): boolean {
  if (!text) return false
  /* No `g` flag: nothing to carry between calls. */
  return new RegExp(PATTERN_SOURCE, 'i').test(text)
}
