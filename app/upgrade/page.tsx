import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";
import { normalizePlanFamilyInput } from "@/lib/monetization/upgradeDestination";

export default async function UpgradePage(
  props: {
    searchParams?: Promise<{ plan?: string | string[]; offer?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const plan = Array.isArray(searchParams?.plan) ? searchParams?.plan[0] : searchParams?.plan;
  const focusPlanFamily = normalizePlanFamilyInput(plan);
  const monthlyOffer = Boolean(focusPlanFamily && searchParams?.offer === "monthly");
  return (
    <MonetizationPurchaseSurface
      pagePath="/upgrade"
      title="Upgrade Your AllFantasy Access"
      subtitle={monthlyOffer
        ? "Review the monthly plan and its checkout terms."
        : "Unlock premium tools and planning workflows with monthly or yearly options."}
      focusPlanFamily={focusPlanFamily}
      monthlyOffer={monthlyOffer}
    />
  );
}
