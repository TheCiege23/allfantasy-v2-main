import type { Metadata } from "next"
import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildMetadata } from "@/lib/seo"
import { getSEOPageConfig } from "@/lib/seo"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig("waiver-ai") ?? {
    title: "Waiver Wire Advisor | AllFantasy",
    description: "AI-powered waiver and lineup help for fantasy leagues.",
    canonical: `${getPublicSiteOrigin()}/waiver-ai`,
  }
)

export default function WaiverAILayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
