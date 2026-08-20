import { TokenCentreV4 } from "@/components/core-app/screens/TokenCentreV4";
import { getMonetizationCatalog } from "@/lib/monetization/catalog";

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

export default function TokensPage() {
  const packs = getMonetizationCatalog().tokenPacks.map((t) => ({
    sku: t.sku,
    amountUsd: t.amountUsd,
    tokenAmount: t.tokenAmount,
  }));

  return <TokenCentreV4 packs={packs} />;
}
