import type { Metadata } from "next"
import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"
import { buildMetadata, getSEOPageConfig } from "@/lib/seo"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig("trade-evaluator") ?? {
    title: "Trade Evaluator – Analyze Deals in Context | AllFantasy",
    description:
      "Evaluate fantasy trades with league context. Get grades, lineup impact, and AI explanations for both sides.",
    canonical: `${getPublicSiteOrigin()}/trade-evaluator`,
  }
)

export default function TradeEvaluatorLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
