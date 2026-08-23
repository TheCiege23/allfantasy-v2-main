import type { ReactNode } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildSeoMeta } from "@/lib/seo"
import {
  LEGACY_DEFAULT_TAB,
  LEGACY_DESCRIPTION,
  LEGACY_TAB_TITLES,
} from "./legacy-tab-seo"

/*
 * ⚠ THIS ROUTE DECLARED NO METADATA AT ALL, AND IT IS IN sitemap.xml AT 0.8.
 *
 * app/af-legacy/page.tsx is a client component, so it cannot export `metadata`,
 * and this layout exported none — so /af-legacy inherited the ROOT layout's
 * metadata wholesale. Measured on the served HTML before this change:
 *
 *   <title>AllFantasy – Fantasy Sports Tools Powered by Chimmy</title>
 *   <meta name="description" content="AllFantasy combines fantasy sports …">
 *   <meta property="og:title" content="AllFantasy – Fantasy Sports Tools …">
 *   canonical: none        og:url: none        robots: index, follow
 *
 * i.e. the homepage's title, the homepage's share preview, and no canonical,
 * on a page submitted to search engines at priority 0.8 — while fifteen
 * carefully written SEO titles sat one file away, reachable only by running
 * JavaScript. See legacy-tab-seo.ts.
 *
 * The canonical is the bare path on purpose: all fifteen tabs are `?tab=`
 * variants of this one URL and consolidate onto it.
 */
export const metadata: Metadata = buildSeoMeta({
  title: LEGACY_TAB_TITLES[LEGACY_DEFAULT_TAB],
  description: LEGACY_DESCRIPTION,
  canonicalPath: "/af-legacy",
})

const LEGACY_TABS = [
  { href: "/af-legacy?tab=overview", label: "Overview" },
  { href: "/af-legacy?tab=transfer", label: "Imports" },
  { href: "/af-legacy?tab=player-finder", label: "Team Scan" },
  { href: "/af-legacy?tab=rankings", label: "Team Direction" },
  { href: "/af-legacy?tab=mock-draft", label: "AF Legacy Draft" },
  { href: "/af-legacy?tab=trade", label: "Trade Command Center" },
  { href: "/af-legacy?tab=finder", label: "Trade Review" },
  { href: "/af-legacy?tab=strategy", label: "Renegotiation" },
  { href: "/af-legacy?tab=pulse", label: "Market Board" },
  { href: "/af-legacy?tab=waiver", label: "Waiver Engine" },
  { href: "/af-legacy?tab=compare", label: "Opponent Behavior" },
  { href: "/af-legacy?tab=share", label: "League Fairness" },
  { href: "/af-legacy?tab=chat", label: "Chimmy Chat" },
] as const

export default function AFLegacyLayout({ children }: { children: ReactNode }) {
  return (
    <ProductShellLayout>
      <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
        <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {LEGACY_TABS.map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              className="whitespace-nowrap rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </ProductShellLayout>
  )
}
