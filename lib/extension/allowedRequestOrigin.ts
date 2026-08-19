/**
 * Narrow, additive origin trust check for the ESPN one-click browser extension
 * (AF_ESPN_EXTENSION_CONNECT_BUILD.md §3-4). This only ever ADDS a rejection for a
 * cross-origin `Origin` header that isn't the app's own origin or the configured extension
 * origin — it never weakens the existing session-auth check, and is scoped to
 * app/api/league/auth's POST handler only. No other route reads or is affected by this.
 *
 * Fail-closed by design: until ESPN_EXTENSION_ID is configured (post-publish), no
 * chrome-extension:// origin is trusted at all.
 */
export function isAllowedLeagueAuthRequestOrigin(input: {
  /** The request's `Origin` header, or null if absent (typical of same-origin requests). */
  originHeader: string | null
  /** The app's own public origin, e.g. "https://www.allfantasy.ai". */
  appOrigin: string
  /** The published extension's Chrome-assigned ID, from ESPN_EXTENSION_ID. */
  extensionId: string | null | undefined
}): boolean {
  const { originHeader, appOrigin, extensionId } = input

  // No Origin header — the common case for same-origin browser requests (the existing manual
  // paste form). Unchanged from today's behavior.
  if (!originHeader) return true

  if (originHeader === appOrigin) return true

  const trimmedExtensionId = (extensionId ?? '').trim()
  if (trimmedExtensionId && originHeader === `chrome-extension://${trimmedExtensionId}`) {
    return true
  }

  return false
}
