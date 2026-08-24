import type { Metadata } from "next"
import type { ReactNode } from "react"

/*
 * ⚠ EVERY TOKEN-GATED PAGE UNDER /mock-draft RETURNED 200 FOR ANY ID, AND
 * INVITED CRAWLERS IN. Measured before this file existed, on ids that do not
 * exist — /mock-draft/share/test123, /mock-draft/abc/replay, /mock-draft/join:
 *
 *   status      200               <- not 404
 *   robots      index, follow
 *   canonical   none
 *   h1          none
 *   title       AllFantasy – Fantasy Sports Tools Powered by Chimmy   <- the homepage's
 *   body        134 chars: "No invite token. Use a link shared by the mock draft host."
 *
 * The id segments are unbounded, so that is an unlimited supply of crawlable
 * URLs which all answer 200 with the same thin error page under the homepage's
 * title — a soft-404 farm. These are per-draft invite surfaces reached from a
 * link somebody was sent; not one of them should ever be a search result, valid
 * id or not, so this is `noindex` on the whole subtree rather than a 404 rule
 * that would still have to guess which ids are real.
 *
 * `follow` is kept so any legitimate link out of these pages still passes.
 *
 * ⚠ THIS DELIBERATELY DOES NOT COVER /mock-draft ITSELF, and cannot: page.tsx
 * exports its own `metadata`, and Next resolves `robots` from the deepest
 * declaration, so the page wins. That is fine — /mock-draft `redirect()`s every
 * signed-out visitor to /login before any HTML exists, so no crawler ever sees
 * its metadata. Its sitemap entry is removed in the same change instead; see
 * app/sitemap.xml/route.ts.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default function MockDraftLayout({ children }: { children: ReactNode }) {
  return children
}
