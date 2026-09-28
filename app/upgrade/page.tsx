import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";
import { normalizePlanFamilyInput } from "@/lib/monetization/upgradeDestination";

export default function UpgradePage({
  searchParams,
}: {
  searchParams?: { plan?: string | string[] };
}) {
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
