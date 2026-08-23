import type { Metadata } from 'next'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { PricingV4, type PricingPlan, type PricingPack } from '@/components/core-app/screens/PricingV4'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import { getPlanPresentations, getMinYearlySavingPct } from '@/lib/monetization/planPresentation'
import { buildSeoMeta, getFAQPageSchema } from '@/lib/seo'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import {
  getPricingCopy,
  PRICING_PATHS,
  PRICING_LANGS,
  DEFAULT_PRICING_LANG,
  type PricingLang,
} from '@/lib/i18n/pricing-copy'

/**
 * The pricing page, shared by /pricing (English) and /es/pricing (Spanish).
 *
 * ⚠ PRICES ARE READ FROM THE CATALOG ON THE SERVER AND PASSED DOWN. Nothing here
 * or in the copy module states a figure. Token grants were wrong in three
 * separate files, every one of which had transcribed a number instead of
 * deriving it; a pricing page that restates prices is simply a fourth place for
 * them to drift, and a TRANSLATED one is a fifth in a language nobody on the
 * team reads back.
 *
 * ⚠ THE SEO DESCRIPTIONS DELIBERATELY NAME NO PRICE, in either language.
 * Metadata is the one part a reader cannot see updating, so a number there would
 * rot silently while the visible page stayed correct.
 */

export type PricingSearchParams = { [key: string]: string | string[] | undefined }

export function buildPricingMetadata(lang: PricingLang): Metadata {
  const copy = getPricingCopy(lang)
  return buildSeoMeta({
    title: copy.meta.title,
    description: copy.meta.description,
    canonicalPath: PRICING_PATHS[lang],
    languageAlternates: {
      ...Object.fromEntries(PRICING_LANGS.map((code) => [code, PRICING_PATHS[code]])),
      'x-default': PRICING_PATHS[DEFAULT_PRICING_LANG],
    },
    ogLocale: copy.ogLocale,
    openGraphTitle: copy.meta.ogTitle,
    openGraphDescription: copy.meta.ogDescription,
    twitterTitle: copy.meta.ogTitle,
    twitterDescription: copy.meta.ogDescription,
    /*
     * ⚠ `/og-image.jpg`, NOT `/af-crest.png`. This page was the last one in the
     * repo still pointing at the crest: 1024×1024, and JPEG bytes despite the
     * extension, rendered into a `summary_large_image` card and a 1.91:1
     * OpenGraph slot. Every share of the pricing page got the logo cropped.
     */
    imagePath: '/og-image.jpg',
    keywords: [
      'AllFantasy pricing',
      'fantasy sports subscription',
      'fantasy football tools',
      'Chimmy',
      'fantasy commissioner tools',
      ...(lang === 'es'
        ? ['precios fantasy', 'suscripción fantasy', 'herramientas de fantasy en español']
        : []),
    ],
  })
}

/** First value of a possibly-repeated query parameter. */
function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === 'string' ? value : null
}

export function PricingRoute({
  lang,
  searchParams,
}: {
  lang: PricingLang
  searchParams?: PricingSearchParams
}) {
  const copy = getPricingCopy(lang)
  const presentations = getPlanPresentations()

  const plans: PricingPlan[] = presentations.map((p) => ({
    planFamily: p.planFamily,
    name: p.name,
    description: p.description,
    monthlySku: p.monthly?.sku ?? null,
    monthlyPrice: p.monthly?.amountUsd ?? null,
    yearlySku: p.yearly?.sku ?? null,
    yearlyPrice: p.yearly?.amountUsd ?? null,
    savings: p.savings
      ? {
          savedUsd: p.savings.savedUsd,
          savedPct: p.savings.savedPct,
          effectiveMonthly: p.savings.effectiveMonthly,
        }
      : null,
  }))

  const packs: PricingPack[] = getMonetizationCatalog().tokenPacks.map((t) => ({
    sku: t.sku,
    title: t.title,
    amountUsd: t.amountUsd,
    tokenAmount: t.tokenAmount,
  }))

  /*
   * The sku the visitor picked before a 401 sent them to signup, handed back on
   * the callbackUrl. Read here rather than with useSearchParams inside the client
   * component, so the mark is in the server-rendered HTML and no Suspense
   * boundary is needed.
   */
  const pickedSku = firstParam(searchParams?.plan)

  /*
   * ⚠ THIS PAGE PREVIOUSLY EMITTED NO STRUCTURED DATA OF ITS OWN AT ALL — the only
   * JSON-LD in its response was the site-wide WebSite/Organization pair from the
   * root layout. It renders four FAQs and four priced plans and declared neither,
   * on the highest-intent page on the site, while the landing page has emitted
   * FAQPage for months.
   *
   * Both nodes are DERIVED: the FAQs from the same array the page renders, and
   * the offers from the same catalog presentations the cards read, so neither can
   * advertise an answer or a price the page does not actually show. That matters
   * more than usual for `Offer` — a rich result quoting a stale price is a
   * price the checkout will not honour.
   */
  const faqSchema = getFAQPageSchema(copy.faq.items)
  const origin = getPublicSiteOrigin()
  const offerSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'AllFantasy',
    description: copy.meta.description,
    url: `${origin}${PRICING_PATHS[lang]}`,
    brand: { '@type': 'Brand', name: 'AllFantasy' },
    offers: presentations
      .filter((p) => p.monthly?.amountUsd != null)
      .map((p) => ({
        '@type': 'Offer',
        name: p.name,
        price: String(p.monthly!.amountUsd),
        priceCurrency: 'USD',
        category: 'subscription',
        url: `${origin}${PRICING_PATHS[lang]}`,
        availability: 'https://schema.org/InStock',
      })),
  }

  return (
    <>
      <PageJsonLd schemas={[faqSchema, offerSchema]} />
      <PricingV4
        plans={plans}
        packs={packs}
        savingsPct={getMinYearlySavingPct(presentations)}
        pickedSku={pickedSku}
        lang={lang}
      />
    </>
  )
}
