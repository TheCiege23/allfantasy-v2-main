/**
 * Result questions often name only a club and a result verb — for example
 * "did the Yankees win today?". They contain none of Chimmy's generic sports
 * keywords even though the deterministic score reader can answer them.
 *
 * Keep this narrower than a bare `win` match. "Who won the 1992 World Series?"
 * follows a separate global-question path, while this predicate exists for the
 * did/has/do result shape that identifies a named subject before the verb.
 */
export function isLikelySportsResultQuestion(text: string): boolean {
  return /\b(?:did|do|does|has|have)\b[^?]{0,80}\b(?:win|won|lose|lost|beat|beaten|tie|tied|play|played)\b/i.test(text)
}
