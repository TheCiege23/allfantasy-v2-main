import type { ReactNode } from "react"
import type { Metadata } from "next"

/*
 * ⚠ THIS FILE EXISTS TO STOP AN INHERITED CANONICAL, NOT TO ADD A PAGE.
 *
 * app/af-legacy/layout.tsx now declares `alternates.canonical = /af-legacy`.
 * Next merges metadata by top-level field, so without this file the child route
 * inherits it — measured, before this layout was added:
 *
 *   /af-legacy/trade-analyzer  →  canonical https://www.allfantasy.ai/af-legacy
 *                                 title "Fantasy Football Career Profile …"
 *
 * i.e. the page declared itself a duplicate of its parent. That is the same
 * defect as 39ab1f8 (the root layout's canonical inherited by ~350 pages), one
 * level down, and it would have been introduced by the fix rather than found.
 *
 * NOINDEX RATHER THAN A SELF-CANONICAL, DELIBERATELY. This route is orphaned —
 * a repo-wide search finds no link to it from any page, component, config or
 * the sitemap; the only references are generated .next type stubs. It also
 * duplicates two live surfaces: the `?tab=trade` tab of /af-legacy and the
 * public /trade-analyzer, which has its own canonical and its own title. A
 * self-canonical would invite a crawler to index a third copy that no visitor
 * can navigate to. Whether this route should be wired up or deleted is a
 * product decision, not an audit's — flagged on the PR.
 */
/*
 * `openGraph` and `twitter` are overridden for the same inheritance reason as
 * the canonical: without them this page's share preview is the parent's title
 * and the parent's og:url, so a pasted link to this route advertises a
 * different page. Pointing them at this URL is honest and costs nothing —
 * og:url is a share-preview field, not an indexing signal, so it does not
 * reintroduce the self-canonical the noindex above is avoiding.
 */
export const metadata: Metadata = {
  title: "Trade Analyzer | AF Legacy",
  robots: { index: false, follow: true },
  alternates: { canonical: undefined },
  openGraph: {
    title: "Trade Analyzer | AF Legacy",
    url: "/af-legacy/trade-analyzer",
  },
  twitter: {
    title: "Trade Analyzer | AF Legacy",
  },
}

export default function AFLegacyTradeAnalyzerLayout({ children }: { children: ReactNode }) {
  return children
}
