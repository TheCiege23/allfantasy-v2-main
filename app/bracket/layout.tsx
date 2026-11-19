import type { Metadata } from "next"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"
import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildMetadata, getSEOPageConfig } from "@/lib/seo"

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig("bracket-challenge") ?? {
    title: "AllFantasy NCAA Bracket Challenge – Pools, Picks & Standings",
    description:
      "Play the AllFantasy NCAA Bracket Challenge. Create pools, invite friends, track standings, and use Chimmy to pressure-test your picks.",
    canonical: `${getPublicSiteOrigin()}/bracket`,
  }
)

export default function BracketLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
