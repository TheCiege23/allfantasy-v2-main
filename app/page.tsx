import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { LandingInviteCapture } from '@/components/landing/LandingInviteCapture'
import { LandingViewBeacon } from '@/components/landing/LandingViewBeacon'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import {
  getLandingCopy,
  resolveLandingLang,
  DEFAULT_LANDING_LANG,
  LANDING_LANGS,
} from '@/lib/i18n/landing-copy'
import {
  buildSeoMeta,
  getFAQPageSchema,
  getSoftwareApplicationSchema,
  getWebPageSchema,
} from '@/lib/seo'
import { getPlanPresentations, getMonthlyPriceRange } from '@/lib/monetization/planPresentation'

/**
 * Landing page (Nocturne "1a" design). Replaces the legacy scrollytelling
 * `LandingPageClient`, which stays on disk for one-line rollback.
 *
 * Server-rendered: `LandingNocturne` is a client component but is now STATICALLY
 * imported (not `dynamic(..., { ssr: false })`), so its full marketing HTML —
 * headline, platform copy, features, pricing, commissioner content — ships in the
 * server response for crawlers and link previews instead of a "Loading…" shell.
 *
 * The prior `ssr: false` existed only to dodge a Windows Next 14.2 webpack crash
 * (`reading 'call'` at `next/image`) when SSR-bundling this module. That trigger is
 * gone: the Nocturne components now use plain <img> for their few brand PNGs rather
 * than next/image, so the module SSR-bundles cleanly. If that webpack crash ever
 * resurfaces, the one-line rollback is to wrap this import in
 * `dynamic(() => import(...), { ssr: false })` again.
 */

type HomeSearchParams = { [key: string]: string | string[] | undefined }

/**
 * ⚠ THIS WAS A STATIC `metadata` EXPORT AND HAD TO BECOME A FUNCTION. The page
 * now renders in two languages off `?lang=`, and a static export cannot see the
 * request — it would have served the English title and description over the
 * Spanish document, which is the one SEO mistake a translated page can make that
 * is worse than not translating at all.
 *
 * `alternates.languages` declares the pair to crawlers, and English keeps the
 * bare `/` canonical so the two languages are never treated as duplicate content.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: HomeSearchParams
}): Promise<Metadata> {
  const lang = resolveLandingLang(searchParams?.lang)
  // The metadata strings quote no price, but getLandingCopy now requires the
  // range so no caller can render the copy without the live catalog behind it.
  const copy = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))

  return buildSeoMeta({
    title: copy.meta.title,
    description: copy.meta.description,
    // Canonical follows the rendered language, so `/?lang=es` does not claim to
    // be `/` — they are different documents and each should rank as itself.
    canonicalPath: lang === DEFAULT_LANDING_LANG ? '/' : `/?lang=${lang}`,
    languageAlternates: {
      ...Object.fromEntries(
        LANDING_LANGS.map((code) => [
          code,
          code === DEFAULT_LANDING_LANG ? '/' : `/?lang=${code}`,
        ]),
      ),
      'x-default': '/',
    },
    ogLocale: copy.ogLocale,
    openGraphTitle: copy.meta.ogTitle,
    openGraphDescription: copy.meta.ogDescription,
    twitterTitle: copy.meta.ogTitle,
    twitterDescription: copy.meta.ogDescription,
    imagePath: '/af-crest.png',
    keywords: [
      'fantasy sports',
      'fantasy football',
      'fantasy basketball',
      'trade analyzer',
      'waiver wire',
      'draft assistant',
      'dynasty fantasy',
      'devy fantasy',
      'fantasy league commissioner',
      'AllFantasy',
      // Spanish-language queries only make sense to claim on the Spanish document.
      ...(lang === 'es'
        ? ['fantasy en español', 'liga de fantasy', 'fantasy football en español']
        : []),
    ],
  })
}

const HOME_WEBPAGE_SCHEMA = getWebPageSchema({
  name: 'AllFantasy.ai',
  description:
    'Commissioner-first fantasy sports platform for NFL, NBA, NHL, MLB, NCAA, and Soccer with league management, live drafts, trades, and waiver tools.',
  url: '/',
})

const HOME_SOFTWARE_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'AllFantasy.ai',
  description:
    'Commissioner-first fantasy sports platform for serious managers with league management, live drafts, trade tools, and waiver wire tracking.',
  url: 'https://allfantasy.ai/',
  applicationCategory: 'SportsApplication',
})

export default async function HomePage({
  searchParams,
}: {
  searchParams?: HomeSearchParams
}) {
  const lang = resolveLandingLang(searchParams?.lang)

  /*
   * ⚠ `/` NO LONGER REDIRECTS ANYONE AWAY. THE LANDING PAGE IS THE FIRST THING
   * EVERY VISITOR SEES, SIGNED IN OR NOT.
   *
   * This used to be `if (initialSession?.user) redirect('/dashboard')`, and that
   * one line made allfantasy.ai land people on the LOGIN page. The reason is a
   * disagreement between two gates that each looked correct on its own:
   *
   *   here                     `initialSession?.user`         — any truthy user object
   *   app/dashboard/page.tsx   `session.user.id` non-empty    — a real user id
   *
   * Every session in the gap between those two — an expired cookie that still
   * decodes, an OAuth session before its id is attached, any partial session —
   * was treated as signed in HERE, redirected to /dashboard, rejected THERE, and
   * forwarded to /login?callbackUrl=/dashboard. The visitor typed the domain and
   * got a login form, and no amount of reloading escaped it, because `/` bounced
   * them again every time. The marketing page was unreachable for exactly the
   * people whose session was broken.
   *
   * Serving the landing unconditionally removes the whole class of bug: `/` has
   * no redirect left to get wrong. A signed-in reader is offered their dashboard
   * by the nav instead of being teleported into it — see `signedIn` below.
   */
  const initialSession = await getHomeInitialSession()

  /*
   * ⚠ MATCHES THE DASHBOARD'S TEST EXACTLY, AND MUST KEEP MATCHING. This decides
   * whether the nav offers "Dashboard" or "Sign in", so a looser test here would
   * show a Dashboard link to someone /dashboard will bounce straight to /login —
   * the same mismatch that caused the bug above, moved into the nav.
   */
  const signedIn =
    typeof initialSession?.user?.id === 'string' && initialSession.user.id.trim() !== ''

  /*
   * FAQPage structured data, built from the SAME array the page renders.
   *
   * The handoff requires the visible answers and the structured FAQ data to stay
   * in sync. Deriving the schema from `copy.faq.items` rather than maintaining a
   * second list makes that true by construction — including the cost answer,
   * whose figures come from the catalog, so the rich result cannot advertise a
   * price the checkout no longer charges.
   *
   * Unlike the two schemas above this cannot be a module constant: it is
   * language-dependent, and a Spanish page emitting English Q&A would be worse
   * than emitting none.
   */
  const copy = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))
  const faqSchema = getFAQPageSchema(copy.faq.items)

  return (
    <>
      <PageJsonLd schemas={[HOME_WEBPAGE_SCHEMA, HOME_SOFTWARE_APP_SCHEMA, faqSchema]} />
      <Suspense fallback={null}>
        <LandingInviteCapture />
      </Suspense>
      {/*
        ⚠ NOW GATED ON `signedIn` RATHER THAN ON THE REDIRECT. This previously sat
        below the signed-in redirect and relied on it: an authenticated visitor was
        gone before the beacon mounted, so it only ever recorded signed-out views.
        Removing the redirect took that protection away silently — every returning
        signed-in visit would have started counting as campaign-driven acquisition
        and inflated the top of the funnel. The condition restores exactly the old
        behaviour, now stated instead of implied.
      */}
      {signedIn ? null : <LandingViewBeacon landingPath="/" />}
      {/*
        ⚠ CUTOVER: LandingV4 replaced LandingNocturne here. Everything AROUND this
        line is deliberately untouched — the JSON-LD schemas, invite capture, the
        landing-view beacon, and the signed-in redirect above. Those carry the SEO
        and the acquisition attribution; swapping the visual must not cost them.
        One-line rollback: restore the LandingNocturne import and this element.
      */}
      <LandingV4 lang={lang} signedIn={signedIn} />
    </>
  )
}
