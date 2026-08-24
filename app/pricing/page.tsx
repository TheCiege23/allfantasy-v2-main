import type { Metadata } from "next";
import {
  PricingRoute,
  buildPricingMetadata,
  type PricingSearchParams,
} from "@/components/pricing/pricing-route";
import { DEFAULT_PRICING_LANG } from "@/lib/i18n/pricing-copy";

/**
 * /pricing — the English pricing page.
 *
 * The page itself lives in components/pricing/pricing-route.tsx, shared with
 * /es/pricing. Read the header comment there: it explains why no figure is ever
 * written down in this path, and why the two languages are two routes.
 */

export const metadata: Metadata = buildPricingMetadata(DEFAULT_PRICING_LANG);

export const dynamic = "force-dynamic";

export default function PricingPage({
  searchParams,
}: {
  searchParams?: PricingSearchParams;
}) {
  return <PricingRoute lang={DEFAULT_PRICING_LANG} searchParams={searchParams} />;
}
