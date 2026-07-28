/**
 * Safe rendering of links that appear inside Chimmy MESSAGE CONTENT (i.e. the model's own output, or
 * cached prior-turn content). The LLM must never be able to turn an arbitrary or external URL — including
 * a fantasy source-platform URL — into a clickable link or action button: those are a prompt-injection /
 * open-redirect vector ("[Set your lineup](https://evil.example)"). Any real external source-platform
 * action must instead come from a SERVER-resolved action card (the centralized source-link resolver),
 * never from text the model produced.
 *
 * Rule: only an internal, same-origin app route is renderable as a live link from Chimmy content. Everything
 * else (external URLs, protocol-relative `//host`, backslash open-redirects `/\host`, `javascript:`/`data:`
 * schemes) is treated as untrusted and rendered as plain, non-clickable text.
 */

/** True for a same-origin app path like `/league/abc?tab=team`. Rejects `//host`, `/\host`, and non-paths. */
export function isInternalAppHref(href: string | null | undefined): boolean {
  const h = (href ?? '').trim()
  if (!h.startsWith('/')) return false
  if (h.startsWith('//')) return false // protocol-relative → external
  if (h.startsWith('/\\')) return false // backslash open-redirect (`/\evil.com`) → treated as `//` by browsers
  return true
}

/**
 * Whether an href found in Chimmy message content may render as a live link. Internal app routes only —
 * external/anything-else is untrusted (render as text). Server-resolved action cards are the ONLY path
 * for external source-platform links.
 */
export function isRenderableChimmyContentHref(href: string | null | undefined): boolean {
  return isInternalAppHref(href)
}
