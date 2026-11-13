/**
 * LeagueMentionResolver — parse @mentions from league chat text.
 * Used before send to trigger mention notifications via LeagueChatNotificationBridge (API).
 */

const MENTION_REGEX_GLOBAL = /@([a-zA-Z0-9_]+)/g

type LeagueMentionRange = { start: number; end: number; username: string }

export function parseMentions(text: string): string[] {
  const matches = text.match(MENTION_REGEX_GLOBAL) || []
  const normalized = matches
    .map((m) => m.slice(1).trim().replace(/^@+/, ""))
    .filter(Boolean)
  return [...new Set(normalized)]
}

export function getLeagueMentionRanges(text: string): LeagueMentionRange[] {
  const ranges: LeagueMentionRange[] = []
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
