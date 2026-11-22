import type { Metadata } from "next"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"
import type { ReactNode } from "react"
import { buildMetadata } from "@/lib/seo"
import { getSEOPageConfig } from "@/lib/seo"

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig("trade-analyzer") ?? {
    title: "Fantasy Trade Analyzer | AllFantasy",
    description: "Chimmy-powered trade grades and analysis for fantasy sports.",
    canonical: `${getPublicSiteOrigin()}/trade-analyzer`,
  }
)

export default function TradeAnalyzerLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
