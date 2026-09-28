import { Fragment, type ReactNode } from 'react'

/**
 * Message text for league chat, DMs and huddles: links become links, @mentions keep their
 * highlight, everything else stays text. `ChatMessageList` is the one place a bubble's words are
 * drawn, so this is the one place that turns them into nodes.
 *
 * 🛑 NO HTML. Every piece comes back as a React node built here — never a string handed to
 * `dangerouslySetInnerHTML` — so a message can only ever render as the characters it contains.
 *
 * 🛑 ONLY http(s):// AND BARE www. The pattern cannot match `javascript:`, `data:`, `mailto:` or
 * anything else, and every candidate is re-parsed with `URL` and must come back `http:`/`https:`
 * before it becomes an `<a>`. A bare `www.` link is sent to `https://`.
 */

export type MessageTextToken =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string }
  | { kind: 'link'; text: string; href: string }

/*
 * A candidate starts at http://, https:// or www. and runs to whitespace. `<`, `>` and quotes end
 * it too: they are never part of a URL someone typed, and are where a pasted snippet's markup starts.
 */
const URL_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const MENTION_SPLIT = /(@[A-Za-z0-9_]+)/g
const MENTION_WHOLE = /^@[A-Za-z0-9_]+$/

/** Sentence punctuation that follows a link far more often than it belongs to one. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"'])
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

function count(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n += 1
  return n
}

/**
 * "(see https://x.com/a_(b))." keeps the balanced `)` inside the link and gives back the rest.
 * A closer is trimmed only when the link holds more of it than of its opener.
 */
export function trimTrailingPunctuation(candidate: string): string {
  let out = candidate
  for (;;) {
    const last = out.charAt(out.length - 1)
    if (!last) return out
    if (TRAILING.has(last)) {
      out = out.slice(0, -1)
      continue
    }
    const opener = CLOSERS[last]
    if (opener && count(out, last) > count(out, opener)) {
      out = out.slice(0, -1)
      continue
    }
    return out
  }
}

/** The href for a candidate, or null when it is not a safe web link. */
export function safeLinkHref(candidate: string): string | null {
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate
  if (!/^https?:\/\//i.test(withScheme)) return null
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // "https://" alone, or "www." with nothing after it, is not somewhere to go.
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return parsed.hostname === 'localhost' ? parsed.href : null
  }
  if (parsed.username || parsed.password) return null
  return parsed.href
}

function pushText(out: MessageTextToken[], text: string) {
  if (!text) return
  for (const part of text.split(MENTION_SPLIT)) {
    if (!part) continue
    if (MENTION_WHOLE.test(part)) out.push({ kind: 'mention', text: part })
    else {
      const prev = out[out.length - 1]
      if (prev && prev.kind === 'text') prev.text += part
      else out.push({ kind: 'text', text: part })
    }
  }
}

/** Splits a message into text, @mention and link pieces. Pure, so it can be tested without a DOM. */
export function tokenizeMessageText(text: string): MessageTextToken[] {
  const out: MessageTextToken[] = []
  let cursor = 0
  URL_CANDIDATE.lastIndex = 0
  for (let m = URL_CANDIDATE.exec(text); m; m = URL_CANDIDATE.exec(text)) {
    const start = m.index
    const before = start > 0 ? text.charAt(start - 1) : ''
    /*
     * "xhttps://…" or "awww.…" is the tail of a word, not the start of a link, and the "www." inside
     * "javascript://www.…" follows a slash — none of them start one.
     */
    if (before && /[A-Za-z0-9@/.]/.test(before)) continue
    const candidate = trimTrailingPunctuation(m[0])
    const href = candidate ? safeLinkHref(candidate) : null
    if (!href) continue
    pushText(out, text.slice(cursor, start))
    out.push({ kind: 'link', text: candidate, href })
    cursor = start + candidate.length
    // Resume right after what we kept, so trimmed punctuation goes back to being text.
    URL_CANDIDATE.lastIndex = cursor
  }
  pushText(out, text.slice(cursor))
  return out
}

/** The bubble's words as React nodes: `<a>` for links, the mention highlight, plain text otherwise. */
export function renderMessageText(text: string): ReactNode {
  const tokens = tokenizeMessageText(text)
  if (tokens.length === 1 && tokens[0]!.kind === 'text') return text
  return tokens.map((t, i) => {
    if (t.kind === 'link') {
      return (
        <a
          key={i}
          className="af-cm-link"
          href={t.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
        >
          {t.text}
        </a>
      )
    }
    if (t.kind === 'mention') {
      return (
        <span key={i} className="af-cm-mention">
          {t.text}
        </span>
      )
    }
    return <Fragment key={i}>{t.text}</Fragment>
  })
}
