import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
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
  getSoftwareApplicationSchema,
  getWebPageSchema,
} from '@/lib/seo'

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
  const copy = getLandingCopy(lang)

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
  const initialSession = await getHomeInitialSession()
  if (initialSession?.user) {
    redirect('/dashboard')
  }

  return (
    <>
      <PageJsonLd schemas={[HOME_WEBPAGE_SCHEMA, HOME_SOFTWARE_APP_SCHEMA]} />
      <Suspense fallback={null}>
        <LandingInviteCapture />
      </Suspense>
      {/*
        Mounted below the signed-in redirect above, so an authenticated user bounced to
        /dashboard never records a landing view — that is a returning session, not
        campaign-driven acquisition.
      */}
      <LandingViewBeacon landingPath="/" />
      {/*
        ⚠ CUTOVER: LandingV4 replaced LandingNocturne here. Everything AROUND this
        line is deliberately untouched — the JSON-LD schemas, invite capture, the
        landing-view beacon, and the signed-in redirect above. Those carry the SEO
        and the acquisition attribution; swapping the visual must not cost them.
        One-line rollback: restore the LandingNocturne import and this element.
      */}
      <LandingV4 lang={lang} />
    </>
  )
}
