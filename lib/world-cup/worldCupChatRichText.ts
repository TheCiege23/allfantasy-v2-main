const WORLD_CUP_CHAT_ALLOWED_COLORS = [
  "default",
  "af-blue",
  "red",
  "amber",
  "green",
  "purple",
] as const

const WORLD_CUP_CHAT_ALLOWED_FONTS = [
  "default",
  "clean",
  "sport",
  "mono",
] as const

export type WorldCupChatColor = typeof WORLD_CUP_CHAT_ALLOWED_COLORS[number]
export type WorldCupChatFont = typeof WORLD_CUP_CHAT_ALLOWED_FONTS[number]

type WorldCupChatRichTextMarks = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: WorldCupChatColor
  font?: WorldCupChatFont
}

export type WorldCupChatRichTextSegment = {
  text: string
  marks: WorldCupChatRichTextMarks
}

const MAX_CHAT_CHARS = 1000
const CONTROL_CHARS_EXCEPT_NEWLINE_AND_TAB = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const UNSAFE_HTML_ATTRIBUTES = /\s(?:style|on[a-z]+)\s*=/gi
const UNSAFE_HTML_TAG_NAMES = /<\/?(?:script|style|iframe|object|embed|img|svg|math|link|meta|base|form|input|button|video|audio|source|canvas)\b[^>]*>/gi
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/gi

function isAllowedColor(value: string): value is WorldCupChatColor {
  return (WORLD_CUP_CHAT_ALLOWED_COLORS as readonly string[]).includes(value)
}

function isAllowedFont(value: string): value is WorldCupChatFont {
  return (WORLD_CUP_CHAT_ALLOWED_FONTS as readonly string[]).includes(value)
}

function normalizeTagText(value: string) {
  return value.trim().toLowerCase()
}

export function sanitizeWorldCupChatMessage(input: string) {
  return input
    .replace(CONTROL_CHARS_EXCEPT_NEWLINE_AND_TAB, "")
    .replace(UNSAFE_HTML_TAG_NAMES, "")
    .replace(UNSAFE_HTML_ATTRIBUTES, " ")
    .replace(HTML_TAG_PATTERN, "")
    .slice(0, MAX_CHAT_CHARS)
}

function sameMarks(a: WorldCupChatRichTextMarks, b: WorldCupChatRichTextMarks) {
  return Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    (a.color ?? "default") === (b.color ?? "default") &&
    (a.font ?? "default") === (b.font ?? "default")
}

function pushSegment(
  segments: WorldCupChatRichTextSegment[],
  text: string,
  marks: WorldCupChatRichTextMarks
) {
  if (!text) return
  const normalizedMarks = {
    ...marks,
    color: marks.color ?? "default",
    font: marks.font ?? "default",
  }
  const previous = segments[segments.length - 1]
  if (previous && sameMarks(previous.marks, normalizedMarks)) {
    previous.text += text
    return
  }
  segments.push({ text, marks: normalizedMarks })
}

function findClosing(input: string, openEnd: number, closeToken: string) {
  const index = input.indexOf(closeToken, openEnd)
  return index >= openEnd ? index : -1
}

function parseInline(
  input: string,
  marks: WorldCupChatRichTextMarks,
  stopToken?: string
): { segments: WorldCupChatRichTextSegment[]; index: number; closed: boolean } {
  const segments: WorldCupChatRichTextSegment[] = []
  let index = 0

  while (index < input.length) {
    if (stopToken && input.startsWith(stopToken, index)) {
      return { segments, index: index + stopToken.length, closed: true }
    }

    const syntax = [
      { open: "**", close: "**", mark: "bold" as const },
      { open: "__", close: "__", mark: "underline" as const },
      { open: "~~", close: "~~", mark: "strike" as const },
      { open: "_", close: "_", mark: "italic" as const },
    ].find((candidate) => input.startsWith(candidate.open, index))

    if (syntax) {
      const closeAt = findClosing(input, index + syntax.open.length, syntax.close)
      if (closeAt !== -1) {
        const inner = input.slice(index + syntax.open.length)
        const parsed = parseInline(inner, { ...marks, [syntax.mark]: true }, syntax.close)
        if (parsed.closed) {
          parsed.segments.forEach((segment) => pushSegment(segments, segment.text, segment.marks))
          index += syntax.open.length + parsed.index
          continue
        }
      }
    }

    const colorMatch = input.slice(index).match(/^\[color=([a-z-]+)\]/i)
    if (colorMatch) {
      const value = normalizeTagText(colorMatch[1] ?? "")
      const closeAt = findClosing(input, index + colorMatch[0].length, "[/color]")
      if (closeAt !== -1 && isAllowedColor(value)) {
        const inner = input.slice(index + colorMatch[0].length)
        const parsed = parseInline(inner, { ...marks, color: value }, "[/color]")
        if (parsed.closed) {
          parsed.segments.forEach((segment) => pushSegment(segments, segment.text, segment.marks))
          index += colorMatch[0].length + parsed.index
          continue
        }
      }
    }

    const fontMatch = input.slice(index).match(/^\[font=([a-z-]+)\]/i)
    if (fontMatch) {
      const value = normalizeTagText(fontMatch[1] ?? "")
      const closeAt = findClosing(input, index + fontMatch[0].length, "[/font]")
      if (closeAt !== -1 && isAllowedFont(value)) {
        const inner = input.slice(index + fontMatch[0].length)
        const parsed = parseInline(inner, { ...marks, font: value }, "[/font]")
        if (parsed.closed) {
          parsed.segments.forEach((segment) => pushSegment(segments, segment.text, segment.marks))
          index += fontMatch[0].length + parsed.index
          continue
        }
      }
    }

    pushSegment(segments, input[index] ?? "", marks)
    index += 1
  }

  return { segments, index, closed: false }
}

export function parseWorldCupChatRichText(input: string) {
  return parseInline(sanitizeWorldCupChatMessage(input), {
    color: "default",
    font: "default",
  }).segments
}
