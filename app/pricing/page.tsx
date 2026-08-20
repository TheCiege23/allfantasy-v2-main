import type { Metadata } from "next";
import { PricingV4, type PricingPlan, type PricingPack } from "@/components/core-app/screens/PricingV4";
import { getMonetizationCatalog } from "@/lib/monetization/catalog";
import { getPlanPresentations, describeYearlySavings } from "@/lib/monetization/planPresentation";
import { buildSeoMeta } from "@/lib/seo";

/**
 * /pricing — cut over to the V4 five-lane grid.
 *
 * ⚠ PRICES ARE READ FROM THE CATALOG ON THE SERVER AND PASSED DOWN. The page
 * states no figure of its own. Token grants were wrong in three separate files
 * this morning, every one of which had transcribed a number instead of deriving
 * it; a pricing page that restates prices is simply a fourth place for them to
 * drift.
 *
 * ⚠ THE SEO DESCRIPTION DELIBERATELY NAMES NO PRICE. Metadata is the one part of
 * this file a reader cannot see updating, so a number here would rot silently
 * while the visible page stayed correct — the same failure in a place nobody
 * checks.
 */

export const metadata: Metadata = buildSeoMeta({
  title: "Pricing & Plans — AllFantasy.ai | Fantasy Tools & Subscriptions",
  description:
    "Compare AF Pro, AF Legacy, AF Commissioner and AF Supreme. Tokens for pay-per-use. Secure Stripe checkout. League dues and payouts are handled on FanCred.",
  canonicalPath: "/pricing",
  openGraphTitle: "AllFantasy Pricing — Unlock fantasy tools for your league",
  openGraphDescription:
    "Subscribe for full access, or buy tokens and pay only for what you use. Clear plans, Stripe checkout.",
  imagePath: "/af-crest.png",
  keywords: [
    "AllFantasy pricing",
    "fantasy sports subscription",
    "fantasy football tools",
    "Chimmy",
    "fantasy commissioner tools",
  ],
});

export const dynamic = "force-dynamic";

export default function PricingPage() {
  const presentations = getPlanPresentations();

  const plans: PricingPlan[] = presentations.map((p) => ({
    planFamily: p.planFamily,
    name: p.name,
    description: p.description,
    monthlySku: p.monthly?.sku ?? null,
    monthlyPrice: p.monthly?.amountUsd ?? null,
    yearlySku: p.yearly?.sku ?? null,
    yearlyPrice: p.yearly?.amountUsd ?? null,
    savings: p.savings
      ? {
          savedUsd: p.savings.savedUsd,
          savedPct: p.savings.savedPct,
          effectiveMonthly: p.savings.effectiveMonthly,
        }
      : null,
  }));

  const packs: PricingPack[] = getMonetizationCatalog().tokenPacks.map((t) => ({
    sku: t.sku,
    title: t.title,
    amountUsd: t.amountUsd,
    tokenAmount: t.tokenAmount,
  }));

  return (
    <PricingV4
      plans={plans}
      packs={packs}
      savingsHeadline={describeYearlySavings(presentations)}
    />
  );
}
