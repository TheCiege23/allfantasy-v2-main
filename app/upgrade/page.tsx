import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";
import { normalizePlanFamilyInput } from "@/lib/monetization/upgradeDestination";

export default async function UpgradePage(
  props: {
    searchParams?: Promise<{ plan?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const plan = Array.isArray(searchParams?.plan) ? searchParams?.plan[0] : searchParams?.plan;
  const focusPlanFamily = normalizePlanFamilyInput(plan);
  return (
    <MonetizationPurchaseSurface
      pagePath="/upgrade"
      title="Upgrade Your AllFantasy Access"
      subtitle="Unlock premium tools and planning workflows with monthly or yearly options."
      focusPlanFamily={focusPlanFamily}
    />
  );
}
