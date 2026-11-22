import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { TokenCentreV4 } from "@/components/core-app/screens/TokenCentreV4";
import { authOptions } from "@/lib/auth";
import { loginUrlWithIntent } from "@/lib/auth/auth-intent-resolver";
import { getMonetizationCatalog } from "@/lib/monetization/catalog";
import { buildSeoMeta } from "@/lib/seo";

/**
 * /tokens — cut over to the V4 token centre.
 *
 * ⚠ PACK PRICES COME FROM THE CATALOG, ON THE SERVER. The previous page fetched
 * /api/monetization/catalog from the client to get them; reading the module
 * directly removes a round trip and, more importantly, removes a second shape the
 * same numbers can take. Spend rules and history still come from their APIs
 * because both are per-user.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildSeoMeta({
  title: "Tokens — AllFantasy.ai | Pay only for what you use",
  description:
    "Buy token packs through Stripe and see what every action costs before you run it. Tokens are the pay-per-use path — no subscription required, and what you buy does not reset monthly.",
  canonicalPath: "/tokens",
  openGraphTitle: "AllFantasy Tokens",
  openGraphDescription:
    "Pay only for what you use. Every action shows its cost up front. Checkout powered by Stripe.",
  keywords: ["AllFantasy tokens", "Chimmy tokens", "fantasy pay per use", "fantasy credits"],
});

export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string };
  } | null;
  if (!session?.user?.id) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(await searchParams)) {
      for (const item of [value].flat()) {
        if (item !== undefined) query.append(key, item);
      }
    }
    const search = query.toString();
    redirect(loginUrlWithIntent(search ? `/tokens?${search}` : "/tokens"));
  }

  const packs = getMonetizationCatalog().tokenPacks.map((t) => ({
    sku: t.sku,
    amountUsd: t.amountUsd,
    tokenAmount: t.tokenAmount,
  }));

  return <TokenCentreV4 packs={packs} />;
}
