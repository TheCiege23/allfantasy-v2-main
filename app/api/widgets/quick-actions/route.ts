import { NextResponse } from 'next/server'

import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/**
 * Data source for the `af-quick-actions` widget declared in
 * public/manifest.webmanifest. The Adaptive Card template that consumes it is
 * public/widgets/af-quick-actions.ac.json, and public/sw.js binds the two
 * together in its `widgetinstall` / `widgetresume` handlers.
 *
 * ⚠ THREE FILES OR NONE. A `widgets` entry naming a template or a data URL that
 * does not resolve is worse than having no widget: the OS installs it, the fetch
 * fails, and the user is left with a permanently blank card. The same failure
 * this repo already records for `ingestCFBDStats` — a surface pointed at
 * something nothing keeps alive fails silently and looks correct.
 *
 * ⚠ DELIBERATELY IMPERSONAL, AND THAT IS WHY IT IS `"auth": false`. A Windows
 * widget is fetched by the user agent outside any page context, so this route
 * cannot see a session and must not pretend to. It returns the four
 * destinations the manifest `shortcuts` already advertise — real, accurate, and
 * true for every user. Showing "your" scores here would mean inventing them.
 *
 * Absolute URLs because Action.OpenUrl in an Adaptive Card is opened by the
 * host shell, not by a page, so a site-relative href has nothing to resolve
 * against.
 *
 * ⚠ A KNOWN LIMIT OF THE SIBLING `share_target`, RECORDED HERE BECAUSE THE TWO
 * SHIP TOGETHER: sharing into the app while SIGNED OUT loses the shared text.
 * `/core/players?q=...` 307s to `/login?callbackUrl=%2Fcore%2Fplayers` — the
 * callbackUrl is built from the pathname only, so the query is dropped and the
 * user lands on an empty Player Finder after signing in. Signed in, which is
 * the normal state for an installed app, the share works end to end. Fixing it
 * means teaching the auth redirect to carry search params, which is every
 * redirect in the app and not a PWA change.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const origin = getPublicSiteOrigin()

  const body = {
    title: 'AllFantasy',
    subtitle: 'Every league you play, in one place.',
    leagues: { label: 'My leagues', url: `${origin}/leagues` },
    week: { label: 'Your week', url: `${origin}/core/week` },
    live: { label: 'Live scores', url: `${origin}/core/live` },
    waivers: { label: 'Waivers', url: `${origin}/core/waivers` },
  }

  return NextResponse.json(body, {
    headers: {
      /*
       * `update: 3600` in the manifest is how often the OS is willing to
       * re-fetch; this is how long a fetched copy stays good. Matching them
       * keeps a widget from showing a card older than the refresh it just did.
       */
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  })
}
