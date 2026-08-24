import type { Metadata } from "next"
import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildMetadata } from "@/lib/seo"
import { getSEOPageConfig } from "@/lib/seo"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

/*
 * ⚠ THIS ROUTE AND /tools/waiver-wire-advisor WERE BOTH IN sitemap.xml CARRYING
 * THE SAME TITLE, THE SAME DESCRIPTION AND THE SAME FOUR KEYWORDS — byte for
 * byte, from two hand-written copies in two config files:
 *
 *   lib/seo/SEOPageResolver.ts     "waiver-ai"
 *   lib/seo-landing/config.ts      "waiver-wire-advisor"
 *
 * Two indexed URLs competing for one query is bad on its own. What decides it is
 * WHAT EACH ONE SERVES a visitor who is not signed in. Measured:
 *
 *   /tools/waiver-wire-advisor   2066 chars, h1 "Waiver Wire Advisor"
 *   /waiver-ai                    501 chars, h1 "SIGN IN TO ANALYZE YOUR LEAGUES"
 *
 * So the page promising "AI-powered pickup recommendations and lineup help" to
 * a searcher was, for every signed-out arrival, a login wall — while the real
 * landing page for that exact phrase sat beside it in the same sitemap, losing
 * to it or splitting with it.
 *
 * app/signup/layout.tsx already writes the governing rule down: authentication
 * surfaces must not be indexed. A page whose entire signed-out state is a
 * sign-in prompt is one of those for every crawler that reaches it.
 *
 * `follow` is kept deliberately — link equity still passes through — and the
 * route is untouched for signed-in users. The sitemap entry is removed in the
 * same change; see app/sitemap.xml/route.ts.
 *
 * NOT the same call as /af-legacy (c91b8f88), which stays indexed: that page
 * renders 3079 chars of real onboarding copy signed out and its title does not
 * collide with /tools/legacy-dynasty's. The difference is measured, not assumed.
 */
export const metadata: Metadata = buildMetadata({
  ...(getSEOPageConfig("waiver-ai") ?? {
    title: "Waiver Wire Advisor | AllFantasy",
    description: "AI-powered waiver and lineup help for fantasy leagues.",
    canonical: `${getPublicSiteOrigin()}/waiver-ai`,
  }),
  noIndex: true,
})

export default function WaiverAILayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
