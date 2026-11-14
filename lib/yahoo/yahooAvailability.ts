/**
 * Is Yahoo import open to customers right now? One answer, read from the import config.
 *
 * 🛑 THE YAHOO ENTRY POINTS USED TO IGNORE `available: false`. The import preview/commit routes
 * refuse a coming-soon provider, but the three routes that START a Yahoo connection
 * (`/api/auth/yahoo`, `/api/league/yahoo-auth`) and LIST Yahoo leagues (`/api/yahoo/leagues`) never
 * asked. So the legacy importer's "Connect Yahoo Account" button sent a manager through Yahoo's
 * consent screen and into a 403 Yahoo returns to every unapproved app — an error nothing on their side
 * could fix, on a platform every marketing page calls "coming soon".
 *
 * These routes now refuse BEFORE the round trip, with the same sentence the rest of the product uses.
 * Flipping `yahoo.available` in `lib/league-import/provider-ui-config.ts` reopens all of them at once.
 */

import { NextResponse } from 'next/server'
import { getImportPlatformStatus, importComingSoonMessage } from '@/lib/league-import/provider-ui-config'

/** The `yahoo_error` value a redirecting entry point uses; ImportV4 renders it as a friendly notice. */
export const YAHOO_COMING_SOON_ERROR = 'coming_soon'

export function isYahooImportLive(): boolean {
  return getImportPlatformStatus('yahoo') === 'live'
}

export function yahooComingSoonMessage(): string {
  return importComingSoonMessage('yahoo')
}

/**
 * Owner preview: app user ids allowed through the Yahoo CONNECT flow and `/api/yahoo/leagues`
 * while Yahoo is still coming soon for everyone else. Comma-separated, whitespace ignored.
 *
 * WHY. Yahoo's approval is a precondition nobody here controls, and the switch above is all or
 * nothing — so there was no way to connect a real account, prove the token/refresh/read chain
 * (`scripts/yahoo-live-check.ts`), and only THEN open Yahoo to every manager.
 *
 * ⚠ UNSET MEANS EXACTLY THE OLD BEHAVIOUR. With no list configured, the entry points refuse before
 * reading a session, as they always have — the "coming soon" path costs nothing and asks nobody to
 * sign in. The session is read only when there is a list to check it against.
 *
 * ⚠ IT OPENS CONNECT AND THE LEAGUE LIST, NOT THE IMPORT SCREENS. Those gate on the client-side
 * `available` flag in provider-ui-config, which cannot see a server env var; the import routes
 * still refuse Yahoo. A preview user can connect and run the live check, not import through the UI.
 */
export const YAHOO_PREVIEW_USER_IDS_ENV = 'YAHOO_PREVIEW_USER_IDS'

export function yahooPreviewUserIds(): ReadonlySet<string> {
  const raw = process.env[YAHOO_PREVIEW_USER_IDS_ENV] ?? ''
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  )
}

/** True when an allowlist is configured at all — i.e. it is worth reading the session. */
export function isYahooPreviewConfigured(): boolean {
  return yahooPreviewUserIds().size > 0
}

/**
 * May this user use the Yahoo connect flow and league list right now?
 * Live → everyone (the callers keep their own sign-in checks). Coming soon → allowlisted users only.
 */
export function isYahooOpenForUser(userId: string | null | undefined): boolean {
  if (isYahooImportLive()) return true
  if (!userId) return false
  const open = yahooPreviewUserIds().has(userId)
  if (open) {
    // Id prefix only: enough to tell whose preview it was, without writing a full user id to logs.
    console.info('[Yahoo] owner-preview bypass user=%s', userId.slice(0, 8))
  }
  return open
}

/**
 * The JSON answer for a Yahoo data route while Yahoo is coming soon.
 *
 * 409, not 5xx: nothing is broken, and a 5xx would page someone and count against the error rate.
 * Not 200 either: a caller expecting `leagues` or `teams` would render an empty list and the manager
 * would read "you have no Yahoo leagues", which is the silent failure this replaces. `connected:false`
 * keeps the legacy page's on-mount check (`if (data?.connected)`) on its not-connected branch.
 */
export function yahooComingSoonJson(): NextResponse {
  return NextResponse.json(
    {
      error: yahooComingSoonMessage(),
      code: YAHOO_COMING_SOON_ERROR,
      availability: 'coming_soon',
      connected: false,
    },
    { status: 409 },
  )
}
