/**
 * Chimmy's reply as text a user can paste somewhere else — a group chat, X, Discord.
 *
 * The reply is Markdown (`ChimmyRichText` renders a subset). Pasted raw it reads as `**Start
 * him**` and `- **Intent:**`, so both forms strip it: the same subset the renderer understands,
 * links reduced to their label (the renderer does not render them either).
 */

const inline = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')

/** The whole reply, formatting removed: headings as lines, bullets as "•", rules dropped. */
export function chimmyReplyAsPlainText(markdown: string): string {
  const out: string[] = []
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) continue
    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line)
    const bullet = /^[-*•]\s+(.+)$/.exec(line)
    if (heading) out.push(inline(heading[1]!))
    else if (bullet) out.push(`• ${inline(bullet[1]!)}`)
    else out.push(inline(line))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const SOCIAL_POST_LIMIT = 280
const SIGN_OFF = '— Chimmy on AllFantasy.ai'

/**
 * A short post: the reply's first paragraph, cut at a sentence end to fit one post with the
 * sign-off. A sentence is never cut mid-way; one that alone is too long is cut at a word with "…".
 */
export function chimmyReplyAsSocialPost(markdown: string, limit = SOCIAL_POST_LIMIT): string {
  const plain = chimmyReplyAsPlainText(markdown)
  const first = plain.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).find((p) => p.length > 0) ?? ''
  const room = limit - SIGN_OFF.length - 1
  let body = ''
  for (const sentence of first.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []) {
    const next = `${body} ${sentence.trim()}`.trim()
    if (next.length > room) break
    body = next
  }
  body = body.trim()
  if (!body && first) {
    const cut = first.slice(0, room - 1)
    body = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim()}…`
  }
  return body ? `${body} ${SIGN_OFF}` : SIGN_OFF
}
