import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PricingV4, type PricingPlan, type PricingPack } from "@/components/core-app/screens/PricingV4";
import { getMonetizationCatalog } from "@/lib/monetization/catalog";
import { getPlanPresentations, describeYearlySavings } from "@/lib/monetization/planPresentation";
import { buildSeoMeta } from "@/lib/seo";
import { pricingIntentRedirect } from "@/lib/monetization/upgradeDestination";
import { authOptions } from "@/lib/auth";
import { aiAccessResolver } from "@/lib/ai-access/AIAccessResolver";
import { isSubscriptionEntitlementBypassUserId } from "@/lib/dev-admin/access";
import { getDisplayPlanName } from "@/lib/subscription/feature-access";
import type { PricingAccount } from "@/lib/core-app/pricingAccount";
import { readWeeklyTokenSpend } from "@/lib/tokens/readWeeklyTokenSpend";

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
 *
 * ⚠ AND IT NAMES ONLY THE PLANS THIS PAGE SELLS. It listed AF Legacy, which has
 * been off this grid since 2026-09-24 (see LANE_ORDER in PricingV4) — a search
 * result promising a plan the page does not show.
 */

export const metadata: Metadata = buildSeoMeta({
  title: "Pricing & Plans — AllFantasy.ai | Fantasy Tools & Subscriptions",
  description:
    "Every league is free. Compare AF Pro, AF Commissioner and AF Supreme. Tokens for pay-per-use. Secure Stripe checkout. AllFantasy never holds league dues; commissioners track who has paid.",
  canonicalPath: "/pricing",
  openGraphTitle: "AllFantasy Pricing — Unlock fantasy tools for your league",
  openGraphDescription:
    "Subscribe for full access, or buy tokens and pay only for what you use. Clear plans, Stripe checkout.",
  imagePath: "/og-image.jpg",
  keywords: [
    "AllFantasy pricing",
    "fantasy sports subscription",
    "fantasy football tools",
    "Chimmy",
    "fantasy commissioner tools",
  ],
});

export const dynamic = "force-dynamic";

export default async function PricingPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  /*
   * ⚠ A LINK THAT NAMES A PLAN IS SENT TO THAT PLAN'S CHECKOUT. This grid ignores
   * `?plan=` and `?highlight=`, and does not sell AF Legacy at all, yet locks and
   * World Cup CTAs link here with exactly those — `?plan=af-commissioner`,
   * `?highlight=af-pro`. They landed on a grid with nothing picked out. A bare
   * /pricing, or one carrying only `?from=` / `?msg=`, still renders the grid.
   */
  const intent = pricingIntentRedirect(searchParams);
  if (intent) redirect(intent);

  const session = await getServerSession(authOptions);
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

  /*
   * The Plans board's account layer: which plan the signed-in viewer is on, when it renews and their
   * token balance — the same resolver the /core shell's plan chip reads. A failed read is null and
   * the page renders exactly as it did before (no banner, no YOUR PLAN chip), rather than telling a
   * paying viewer they are on Free.
   */
  const userId = session?.user?.id ?? null;
  let account: PricingAccount | null = null;
  if (userId) {
    const [access, weeklySpend] = await Promise.all([
      aiAccessResolver.resolveForUser({ userId, userEmail: session?.user?.email, now: new Date() }).catch(() => null),
      readWeeklyTokenSpend(userId),
    ]);
    if (isSubscriptionEntitlementBypassUserId(userId, session?.user?.email)) {
      // The spend chart reads the viewer's own ledger, which an admin account has like anyone else.
      account = { planIds: ["supreme"], planName: "AF Supreme", renewsAt: null, tokenBalance: null, weeklySpend };
    } else if (access) {
      const planIds = access.hasSubscription ? access.subscription.plans : [];
      account = {
        planIds,
        planName: planIds[0] ? getDisplayPlanName(planIds[0]) : null,
        renewsAt: access.hasSubscription ? access.subscription.currentPeriodEnd : null,
        tokenBalance: access.tokenBalance,
        weeklySpend,
      };
    }
  }

  return (
    <PricingV4
      plans={plans}
      packs={packs}
      savingsHeadline={describeYearlySavings(presentations)}
      signedIn={Boolean(session?.user?.id)}
      account={account}
    />
  );
}
