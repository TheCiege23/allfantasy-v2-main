import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";

/**
 * Old URL for the retired All-Access tier — now the AF Supreme bundle, which is AF Pro + AF
 * Commissioner + AF Legacy (SUPREME_INCLUDED_PLAN_IDS, Legacy again since 2026-11-27), and the old
 * subtitle's "highest token allowances and subscriber discounts" described grants and discounts that
 * no subscription carries any more.
 */
export default function AllAccessPage() {
  return (
    <MonetizationPurchaseSurface
      pagePath="/all-access"
      title="Upgrade to AF Supreme"
      subtitle="AF Pro, AF Commissioner and AF Legacy in one subscription, for less than buying them separately."
      focusPlanFamily="af_supreme"
    />
  );
}
