/**
 * Pure text helpers for rendering Clubhouse posts. No DOM and no React, so they are
 * tested directly and shared by server and client components.
 */

export type BodySegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

/**
 * http(s) URLs only. `javascript:`, `data:` and bare `www.` are left as text: a link a
 * stranger typed is only ever an ordinary web address.
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

/** Trailing punctuation that belongs to the sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}'"]+$/

export function linkifySegments(text: string): BodySegment[] {
  const out: BodySegment[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    let url = match[0]
    const trail = url.match(TRAILING)?.[0] ?? ''
    if (trail) url = url.slice(0, url.length - trail.length)
    if (!url) continue
    let href: string | null = null
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') href = parsed.toString()
    } catch {
      href = null
    }
    if (!href) continue
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    out.push({ kind: 'link', text: url, href })
    last = start + url.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function displayNameOf(author: { username: string; displayName: string | null }): string {
  return author.displayName?.trim() || author.username
}
