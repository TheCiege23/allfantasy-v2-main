/**
 * Fact check for a machine-written draft: every number and every player it names must come from the
 * facts it was given. A draft that fails is DISCARDED, never repaired — the job writes nothing that day
 * rather than something a reader cannot trust.
 *
 * Numbers: every numeric token in the draft (title, excerpt, SEO fields, body) must appear among the
 * tokens of the serialized facts. Tokens are extracted the SAME way on both sides, so a format the
 * facts do not contain (a percentage the model computed, a season total it remembered) is rejected
 * even when it would be arithmetically right. Ordered-list markers ("1. ") are not numbers.
 * Spelled-out counts next to a stat word ("three assists") are checked as digits too.
 *
 * Names: the check holds a UNIVERSE of real names (every player seen in this sport recently) and
 * rejects a draft that mentions any of them that is not in the day's facts. That is the realistic
 * failure — the model reaching for a famous player who did not play, or played badly — and it
 * avoids guessing which capitalised phrases are names.
 */

const NUMBER_WORDS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
}

const STAT_WORDS =
  "points|rebounds|boards|assists|dimes|steals|blocks|blocked shots|turnovers|threes|three-pointers|goals|saves|shots|hits|games|wins|minutes"

const SPELLED_STAT = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})[ -](?:${STAT_WORDS})\\b`, "gi")

/** Remove markdown link targets — a URL's digits are not claims. */
function stripLinkTargets(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]")
}

/** Numeric tokens in `text`, normalised ("1,234" → "1234", "+3" → "3"). */
export function numberTokens(text: string): string[] {
  const cleaned = stripLinkTargets(text).replace(/^\s*\d+\.\s/gm, "")
  const out: string[] = []
  for (const m of cleaned.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    out.push(m[0].replace(/,/g, "").replace(/\.0+$/, ""))
  }
  for (const m of cleaned.matchAll(SPELLED_STAT)) {
    out.push(NUMBER_WORDS[m[1].toLowerCase()])
  }
  return out
}

export interface FactCheckResult {
  ok: boolean
  unknownNumbers: string[]
  unknownNames: string[]
}

export function checkDraftAgainstFacts(args: {
  draftTexts: string[]
  /** The facts exactly as the model saw them. */
  factsText: string
  /** Names the draft is allowed to use. */
  allowedNames: string[]
  /** Every real name it must NOT use unless allowed. */
  nameUniverse: string[]
}): FactCheckResult {
  const allowedNumbers = new Set(numberTokens(args.factsText))
  const draft = args.draftTexts.join("\n")

  const unknownNumbers = [...new Set(numberTokens(draft).filter((t) => !allowedNumbers.has(t)))]

  const allowed = new Set(args.allowedNames.map((n) => n.toLowerCase()))
  const lowerDraft = stripLinkTargets(draft).toLowerCase()
  const unknownNames = [
    ...new Set(
      args.nameUniverse.filter((name) => {
        const key = name.toLowerCase()
        if (allowed.has(key) || key.length < 5 || !key.includes(" ")) return false
        return containsWord(lowerDraft, key)
      }),
    ),
  ]

  return { ok: unknownNumbers.length === 0 && unknownNames.length === 0, unknownNumbers, unknownNames }
}

/** Whole-phrase match, so "Jalen Green" does not match inside "Jalen Greene". */
function containsWord(haystack: string, needle: string): boolean {
  let from = 0
  while (true) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) return false
    const before = i === 0 ? "" : haystack[i - 1]
    const after = haystack[i + needle.length] ?? ""
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = i + 1
  }
}
