import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";

/**
 * Old URL for the retired All-Access tier — now the AF Supreme bundle, which is AF Pro + AF
 * Commissioner. ⚠ NOT AF Legacy (SUPREME_INCLUDED_PLAN_IDS is [pro, commissioner]), and the old
 * subtitle's "highest token allowances and subscriber discounts" described grants and discounts that
 * no subscription carries any more.
 */
export default function AllAccessPage() {
  return (
    <MonetizationPurchaseSurface
      pagePath="/all-access"
      title="Upgrade to AF Supreme"
      subtitle="AF Pro and AF Commissioner in one subscription, for less than buying both. AF Legacy is sold separately."
      focusPlanFamily="af_supreme"
    />
  );
}
