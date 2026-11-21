import { isIosAppUserAgent } from '@/lib/platform/iosApp'

/**
 * The iOS app's launch screen while /core builds.
 *
 * 🛑 THE APP OPENS ON A BLUE SCREEN FOR AS LONG AS /core TAKES TO BUILD. Reported 2026-11-20: "closed
 * the app, reopened it and it froze on an empty blue screen", while users were installing it. The
 * app (ios-app/capacitor.config.json) loads https://allfantasy.ai/core on every cold start. For a
 * large account that document took 10-18.6s (Railway http logs), and the iPhone showed only the web
 * view's navy background until then — the streamed loading skeleton has almost no text, so WebKit
 * had nothing it would paint. People closed the app before the page arrived.
 *
 * So the app's FIRST document load of bare /core goes to /app-start instead: a tiny page that paints
 * at once (crest, spinner, words), then fetches /core as a client-side navigation and swaps it in.
 * The slow render still happens, but behind a screen that says it is loading.
 *
 * ⚠ ONLY the app's own full-page load of bare /core, signed in:
 *   - the user agent carries `AllFantasyiOS` (set by the app's appendUserAgent);
 *   - no query string — a query is a deep link (`?league=`) and, once /app-start has run,
 *     `?from=app-start`, which is what stops this from looping;
 *   - not an RSC request or a prefetch: those carry `RSC: 1` / `Next-Router-Prefetch`;
 *   - Sec-Fetch-Dest, when sent, must be `document`.
 * Browsers, Android and every in-app tab click are untouched.
 */
export const APP_START_PATH = '/app-start'
/** Where /app-start sends the app. The query is the loop breaker (see above). */
export const APP_START_TARGET = '/core?from=app-start'

export function shouldSendIosLaunchToAppStart(input: {
  pathname: string
  search: string
  headers: Headers
}): boolean {
  if (input.pathname !== '/core' || input.search) return false
  const h = input.headers
  if (!isIosAppUserAgent(h.get('user-agent'))) return false
  if (h.get('rsc') || h.get('next-router-prefetch') || h.get('next-router-state-tree')) return false
  const dest = h.get('sec-fetch-dest')
  if (dest && dest !== 'document') return false
  return true
}
