import type { Metadata } from 'next'
import { CHIMMY_TITLE, CHIMMY_DESCRIPTION } from '@/lib/seo-landing/config'
import ChimmyLandingClient from './ChimmyLandingClient'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { getSoftwareApplicationSchema } from '@/lib/seo'

const BASE = getPublicSiteOrigin()

export const metadata: Metadata = {
  title: CHIMMY_TITLE,
  description: CHIMMY_DESCRIPTION,
  alternates: { canonical: `${BASE}/chimmy` },
  openGraph: {
    title: CHIMMY_TITLE,
    description: CHIMMY_DESCRIPTION,
    url: `${BASE}/chimmy`,
    siteName: 'AllFantasy',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: CHIMMY_TITLE,
    description: CHIMMY_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

/*
 * ⚠ /chimmy DECLARED NO PAGE-LEVEL STRUCTURED DATA — its only JSON-LD was the
 * site-wide WebSite/Organization pair, while every /tools/[tool] page emits a
 * SoftwareApplication. This is the flagship AI surface and it described nothing
 * about itself.
 *
 * ⚠ AND IT IS DELIBERATELY DECLARED WITHOUT A PRICE. The obvious move was to
 * reuse getSoftwareApplicationSchema as-is, which hardcodes
 * offers.price "0" — and lib/monetization/feature-monetization-matrix.ts marks
 * `ai_chat` as accessType "subscription_or_tokens", requiredPlanId "pro",
 * lockedReason "AI Chat is part of AF Pro.", surfaced at exactly this route. So
 * the standard schema would have published "free" for the thing the product
 * charges for, on the page selling it.
 */
const CHIMMY_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'Chimmy',
  description: CHIMMY_DESCRIPTION,
  url: `${BASE}/chimmy`,
  offers: false,
})

export default function ChimmyPage() {
  return (
    <>
      <PageJsonLd schemas={[CHIMMY_APP_SCHEMA]} />
      <EngagementEventTracker
        eventType="chimmy_chat"
        oncePerDayKey="tool_chimmy_chat"
        meta={{ product: "legacy" }}
      />
      <ChimmyLandingClient />
    </>
  )
}
