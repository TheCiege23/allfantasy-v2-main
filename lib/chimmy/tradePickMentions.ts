/**
 * Draft picks named in ONE side of a described trade — "my 2027 1st", "two 2026 seconds".
 *
 * 🛑 ANY TRADE THAT MENTIONED A PICK WAS REFUSED, AND DYNASTY TRADES ARE MOSTLY PICKS. The
 * scenario grader returned `includes_picks` for the whole trade because turning "a 2027 1st" into
 * an asset needs a season and an owner, and nothing extracted them. This does the extraction; the
 * grader decides owner and orientation.
 *
 * ⚠ IT REFUSES WHAT IT CANNOT READ, AND SAYS SO. Two cases come back `unclear` rather than
 * guessed, because a trade valued without one of its assets misstates that whole side:
 *   - a pick-ish word it could not turn into (season, round) — "picks", "draft capital", "1sts"
 *     with no count;
 *   - (reported per pick, as `season: null`) a pick with no year. "A 1st" in September could mean
 *     two different drafts, and they do not price the same.
 *
 * Pure: no I/O, no league knowledge. Unit-tested in `__tests__/chimmy-trade-pick-mentions.test.ts`.
 */

export type PickMention = {
  /** Null when the side named no year for it — the grader refuses rather than assuming one. */
  season: number | null
  round: 1 | 2 | 3 | 4
  /** The text that produced it, for the refusal message. */
  text: string
}

const ROUND: Record<string, 1 | 2 | 3 | 4> = {
  '1st': 1, first: 1,
  '2nd': 2, second: 2,
  '3rd': 3, third: 3,
  '4th': 4, fourth: 4,
}

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, '2': 2, '3': 3 }

/* Same exclusions the grader's old detector used: "1st place", "3rd down", "2nd string" are not picks. */
const NOT_A_PICK = String.raw`(?![\s-]+(?:place|down|quarter|half|string|team|time|look|and\s+goal))`

/*
 * count? year? ordinal plural? pick-word?
 *   "a 2027 1st", "two 2026 seconds", "2027 first-round pick", "my 2028 2nd rounder"
 */
const MENTION = new RegExp(
  String.raw`(?:\b(a|an|one|two|three|2|3)\s+)?(?:\b((?:19|20)\d{2})\s+)?\b(1st|2nd|3rd|4th|first|second|third|fourth)(s)?\b` +
    /* Longest first: "round pick" before "round", or " pick" is left behind and reads as an unparsed pick. */
    String.raw`(?:[\s-]+(round\s+picks?|round(?:er)?s?|picks?))?` +
    NOT_A_PICK,
  'gi',
)

/* Any pick-shaped word at all — what must be fully explained by parsed mentions. */
const PICKISH = new RegExp(
  [
    String.raw`\b(?:1st|2nd|3rd|4th)s?\b` + NOT_A_PICK,
    String.raw`\b(?:first|second|third|fourth)s?[\s-]+(?:round(?:er)?s?|picks?)\b`,
    String.raw`\b(?:19|20)\d{2}\s+(?:first|second|third|fourth)s?\b`,
    String.raw`\bfirsts\b`,
    String.raw`\b(?:draft\s+)?picks?\b(?!\s*up\b)`,
    String.raw`\bdraft\s+capital\b`,
  ].join('|'),
  'i',
)

export function extractPickMentions(sideText: string): { picks: PickMention[]; unclear: boolean } {
  const picks: PickMention[] = []
  let remainder = sideText

  for (const m of sideText.matchAll(MENTION)) {
    const [whole, countWord, year, ordinal, plural, pickWord] = m
    const round = ROUND[ordinal!.toLowerCase()]
    if (!round) continue
    /*
     * "Bijan for Puka first" — a bare ordinal word with no year, no count and no pick word is a
     * sentence, not an asset. Digits ("1st") keep the dynasty shorthand ("and a 1st").
     */
    const isDigitOrdinal = /^\d/.test(ordinal!)
    if (!year && !countWord && !pickWord && !isDigitOrdinal) continue

    const count = countWord ? COUNT[countWord.toLowerCase()] ?? 1 : 1
    /* "1sts" with no number says more than one without saying how many. */
    if (plural && !countWord) continue

    for (let i = 0; i < count; i += 1) {
      picks.push({ season: year ? Number(year) : null, round, text: whole!.trim() })
    }
    remainder = remainder.replace(whole!, ' ')
  }

  /*
   * Anything still pick-shaped after the parsed mentions are removed was named and not understood
   * — "picks", "a future 1st and change", "1sts". Refusing is the only honest option.
   */
  const unclear = PICKISH.test(remainder)
  return { picks, unclear }
}

export function pickLabel(p: { season: number | null; round: number }): string {
  const ord = p.round === 1 ? '1st' : p.round === 2 ? '2nd' : p.round === 3 ? '3rd' : `${p.round}th`
  return `${p.season ?? '(year?)'} ${ord}-round pick`
}
