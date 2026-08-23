import type { Metadata } from "next";
import {
  PricingRoute,
  buildPricingMetadata,
  type PricingSearchParams,
} from "@/components/pricing/pricing-route";

/**
 * /es/pricing — the Spanish pricing page.
 *
 * The page itself lives in components/pricing/pricing-route.tsx, shared with
 * /pricing.
 *
 * ⚠ THIS ROUTE EXISTS BECAUSE /es LINKED STRAIGHT INTO AN ENGLISH PAGE. The
 * Spanish landing's "Comparar planes" and "Planes para comisionados" both went
 * to /pricing, so a reader who chose Spanish on the first screen hit English at
 * the moment they were deciding whether to pay — the one page where confusion
 * costs a sale rather than a scroll.
 *
 * ⚠ NO PRICE IS TRANSLATED, ONLY PROSE. Every figure still comes from the
 * catalog through PricingRoute; lib/i18n/pricing-copy.ts carries no number in
 * either language, on purpose.
 */

export const metadata: Metadata = buildPricingMetadata("es");

export const dynamic = "force-dynamic";

export default function SpanishPricingPage({
  searchParams,
}: {
  searchParams?: PricingSearchParams;
}) {
  return <PricingRoute lang="es" searchParams={searchParams} />;
}
