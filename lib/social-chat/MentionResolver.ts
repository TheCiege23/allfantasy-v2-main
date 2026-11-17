/**
 * MentionResolver — parse @mentions from chat text and support highlighting.
 */

const MENTION_REGEX_GLOBAL = /@([a-zA-Z0-9_]+)/g
const MENTION_REGEX_SINGLE = /@([a-zA-Z0-9_]+)/

export function parseMentions(text: string): string[] {
  const matches = text.match(MENTION_REGEX_GLOBAL) || []
  const normalized = matches
    .map((m) => m.slice(1).trim().replace(/^@+/, ""))
    .filter(Boolean)
  return [...new Set(normalized)]
}

export function hasMentions(text: string): boolean {
  return MENTION_REGEX_SINGLE.test(text)
}

type MentionRange = { start: number; end: number; username: string }

export function getMentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(MENTION_REGEX_GLOBAL.source, "g")
  while ((m = re.exec(text)) !== null) {
    ranges.push({
      start: m.index,
      end: m.index + m[0].length,
      username: m[1],
    })
  }
  return ranges
}

/** For mention suggestion: get the query fragment after the last @ (e.g. " @j" -> { query: "j", startIndex }). */
export function getMentionQueryFromInput(input: string): { query: string; startIndex: number } | null {
  const at = input.lastIndexOf("@")
  if (at === -1) return null
  const after = input.slice(at + 1)
  if (/[\s]/.test(after)) return null
  return { query: after.toLowerCase(), startIndex: at }
}
