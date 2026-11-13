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
