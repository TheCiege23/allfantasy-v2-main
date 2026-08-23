import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'
import { LandingRoute, buildLandingMetadata } from '@/components/landing/landing-route'
import {
  resolveLandingLang,
  DEFAULT_LANDING_LANG,
  LANDING_PATHS,
} from '@/lib/i18n/landing-copy'

/**
 * `/` — the English landing page.
 *
 * The page itself lives in components/landing/landing-route.tsx, shared with
 * /es. Read the header comment there first: it explains why the two languages
 * are two routes rather than one route and a `?lang=` parameter, and what
 * breaks when that is undone.
 *
 * This file is only the English entry point plus the legacy-address handling
 * below.
 */

type HomeSearchParams = { [key: string]: string | string[] | undefined }

export const metadata: Metadata = buildLandingMetadata(DEFAULT_LANDING_LANG)

/**
 * Builds the redirect target for a legacy `?lang=` address, carrying every
 * OTHER query parameter across.
 *
 * ⚠ THE SURVIVING PARAMS ARE NOT OPTIONAL. `?lang=es` is a real address that has
 * been shared, and it arrives carrying things this app reads: `invite`, which
 * LandingInviteCapture consumes to attach a league invite, and the utm_* set the
 * landing beacon attributes acquisition with. Redirecting to a bare `/es` would
 * silently drop an invite on the floor and re-file paid traffic as direct. Only
 * `lang` itself is removed, because the path now carries that meaning.
 */
function legacyLangRedirectTarget(
  searchParams: HomeSearchParams | undefined,
  target: string,
): string {
  const rest = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === 'lang') continue
    if (Array.isArray(value)) {
      for (const v of value) rest.append(key, v)
    } else if (typeof value === 'string') {
      rest.append(key, value)
    }
  }
  const query = rest.toString()
  return query ? `${target}?${query}` : target
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: HomeSearchParams
}) {
  const lang = resolveLandingLang(searchParams?.lang)

  /*
   * ⚠ `/?lang=es` IS A LEGACY ADDRESS AND IS CONSOLIDATED INTO `/es`, NOT SERVED.
   *
   * Serving Spanish here as well would leave two URLs returning the same
   * document — the duplicate-content problem the canonical was supposed to
   * resolve and could not, since Next drops the query from `alternates` and so
   * `/?lang=es` cannot even state that `/es` is its canonical. A 308 removes the
   * second address instead of annotating it, so link equity from anything
   * already pointing at `?lang=es` consolidates onto the page that ranks.
   *
   * `permanentRedirect`, not `redirect`: the latter issues a 307, which asks
   * crawlers to keep the old URL indexed. 308 is the one that transfers.
   *
   * resolveLandingLang accepts regional tags, so `?lang=es-MX` and `?lang=es-419`
   * land here too and consolidate onto the same `/es`. `?lang=en` and any
   * unrecognised value resolve to English and fall through to the render below —
   * no redirect, because this IS the English page.
   */
  if (lang !== DEFAULT_LANDING_LANG) {
    permanentRedirect(legacyLangRedirectTarget(searchParams, LANDING_PATHS[lang]))
  }

  return <LandingRoute lang={DEFAULT_LANDING_LANG} />
}
