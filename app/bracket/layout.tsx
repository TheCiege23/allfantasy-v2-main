import type { Metadata } from "next"
import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildMetadata, getSEOPageConfig } from "@/lib/seo"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig("bracket-challenge") ?? {
    title: "AllFantasy NCAA Bracket Challenge – Pools, Picks & Standings",
    description:
      "Play the AllFantasy NCAA Bracket Challenge. Create pools, invite friends, track standings, and use AI to pressure-test your picks.",
    canonical: `${getPublicSiteOrigin()}/bracket`,
  }
)

export default function BracketLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
