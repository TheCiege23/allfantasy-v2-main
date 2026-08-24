import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { LandingInviteCapture } from '@/components/landing/LandingInviteCapture'
import { LandingViewBeacon } from '@/components/landing/LandingViewBeacon'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'
import { LandingV4 } from '@/components/core-app/screens/LandingV4'
import {
  getLandingCopy,
  DEFAULT_LANDING_LANG,
  LANDING_LANGS,
  LANDING_PATHS,
  type LandingLang,
} from '@/lib/i18n/landing-copy'
import {
  buildSeoMeta,
  getFAQPageSchema,
  getSoftwareApplicationSchema,
  getWebPageSchema,
} from '@/lib/seo'
import { getPlanPresentations, getMonthlyPriceRange } from '@/lib/monetization/planPresentation'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/**
 * The landing page, shared by `/` (English) and `/es` (Spanish).
 *
 * ⚠ THE TWO LANGUAGES ARE TWO ROUTES, NOT ONE ROUTE AND A QUERY PARAM, AND THE
 * REASON IS A NEXT LIMITATION RATHER THAN A PREFERENCE.
 *
 * The Spanish page used to live at `/?lang=es`, and its canonical was declared as
 * `canonicalPath: '/?lang=es'`. Next 14.2 strips the search string when it
 * resolves `alternates` against `metadataBase` — paths survive, queries do not.
 * Measured against a dev server before this change:
 *
 *   /pricing     ->  <link rel="canonical" href="https://www.allfantasy.ai/pricing">   ✓
 *   /?lang=es    ->  <link rel="canonical" href="https://www.allfantasy.ai">           ✗
 *
 * So the Spanish document rendered Spanish copy under a Spanish `<title>` while
 * telling crawlers its canonical URL was the ENGLISH page, and all three
 * `hreflang` alternates collapsed onto that same address. That is the one
 * canonical mistake a translated page can make that is worse than not
 * translating at all — precisely what `generateMetadata` was made async to
 * prevent. The title was fixed then; the canonical was not, because nothing
 * rendered the tag to check it.
 *
 * Passing a `URL` object rather than a string does not help; the stripping is
 * unconditional. A path segment is therefore the only shape that survives, and
 * it is independently what Google prefers for language targeting over a query
 * parameter.
 *
 * Every address here is a bare path for that reason. If you add a third
 * language, give it a path in LANDING_PATHS — never a query string.
 */

/**
 * Metadata for one language of the landing page.
 *
 * `canonicalPath` and every `languageAlternates` value come from LANDING_PATHS,
 * so the canonical, the self-referencing `hreflang` and the sibling `hreflang`
 * are all generated from one table and cannot disagree about where a language
 * lives.
 */
export function buildLandingMetadata(lang: LandingLang): Metadata {
  // The metadata strings quote no price, but getLandingCopy now requires the
  // range so no caller can render the copy without the live catalog behind it.
  const copy = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))

  return buildSeoMeta({
    title: copy.meta.title,
    description: copy.meta.description,
    // Canonical follows the rendered language: `/es` claims to be `/es`, not
    // `/`. They are different documents and each should rank as itself.
    canonicalPath: LANDING_PATHS[lang],
    languageAlternates: {
      ...Object.fromEntries(LANDING_LANGS.map((code) => [code, LANDING_PATHS[code]])),
      'x-default': LANDING_PATHS[DEFAULT_LANDING_LANG],
    },
    ogLocale: copy.ogLocale,
    openGraphTitle: copy.meta.ogTitle,
    openGraphDescription: copy.meta.ogDescription,
    twitterTitle: copy.meta.ogTitle,
    twitterDescription: copy.meta.ogDescription,
    /*
     * ⚠ `/og-image.jpg`, NOT `/af-crest.png`. This is the page whose link
     * preview matters most, and it was the one page opting OUT of the correct
     * card. `/af-crest.png` is 1024×1024 (and, despite the extension, JPEG
     * bytes) — a square crest rendered into a `summary_large_image` Twitter
     * card and a 1.91:1 OpenGraph slot, so every share of the homepage got the
     * logo letterboxed or cropped. `/og-image.jpg` is the real 1200×630 card
     * and is already DEFAULT_OG_IMAGE_PATH in SocialShareMetadataService, so
     * this line now agrees with what every other page gets for free.
     */
    imagePath: '/og-image.jpg',
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

/*
 * ⚠ `url` IS RESOLVED, NOT TYPED. It was the apex literal `https://allfantasy.ai/`,
 * which 307s to www — so the homepage's SoftwareApplication node identified the
 * product by a URL that redirects.
 *
 * Every other structured-data node on this page already agreed with the served
 * host: getWebPageSchema normalises its relative `url` against getPublicSiteOrigin(),
 * and the WebSite + Organization nodes come from the root layout's DefaultJsonLd,
 * which is built from the same helper. This was the last one disagreeing.
 *
 * Note there is deliberately no Organization or BreadcrumbList node added here:
 * Organization already ships site-wide from DefaultJsonLd (a second copy would be
 * a duplicate entity), and a breadcrumb whose only item is the page you are
 * already on carries no information.
 */
const SOFTWARE_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'AllFantasy.ai',
  description:
    'Commissioner-first fantasy sports platform for serious managers with league management, live drafts, trade tools, and waiver wire tracking.',
  url: `${getPublicSiteOrigin()}/`,
  applicationCategory: 'SportsApplication',
})

export async function LandingRoute({ lang }: { lang: LandingLang }) {
  /*
   * ⚠ NEITHER LANDING ROUTE REDIRECTS ANYONE AWAY. THE LANDING PAGE IS THE FIRST
   * THING EVERY VISITOR SEES, SIGNED IN OR NOT.
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
   * Serving the landing unconditionally removes the whole class of bug. A
   * signed-in reader is offered their dashboard by the nav instead of being
   * teleported into it — see `signedIn` below.
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
   * Unlike the SoftwareApplication node above this cannot be a module constant:
   * it is language-dependent, and a Spanish page emitting English Q&A would be
   * worse than emitting none.
   */
  const copy = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))
  const faqSchema = getFAQPageSchema(copy.faq.items)

  /*
   * Language-specific, for the same reason the canonical is: a WebPage node
   * naming `/` on the Spanish document would contradict the canonical two tags
   * above it.
   */
  const webPageSchema = getWebPageSchema({
    name: 'AllFantasy.ai',
    description: copy.meta.description,
    url: LANDING_PATHS[lang],
  })

  return (
    <>
      <PageJsonLd schemas={[webPageSchema, SOFTWARE_APP_SCHEMA, faqSchema]} />
      <Suspense fallback={null}>
        <LandingInviteCapture />
      </Suspense>
      {/*
        ⚠ GATED ON `signedIn` RATHER THAN ON A REDIRECT. This previously sat below
        the signed-in redirect and relied on it: an authenticated visitor was gone
        before the beacon mounted, so it only ever recorded signed-out views.
        Removing the redirect took that protection away silently — every returning
        signed-in visit would have started counting as campaign-driven acquisition
        and inflated the top of the funnel. The condition restores exactly the old
        behaviour, now stated instead of implied.

        `landingPath` is the language's own path, so Spanish traffic reports as
        /es instead of being folded into the English page's numbers.
      */}
      {signedIn ? null : <LandingViewBeacon landingPath={LANDING_PATHS[lang]} />}
      <LandingV4 lang={lang} signedIn={signedIn} />
    </>
  )
}
