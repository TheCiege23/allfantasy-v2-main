import MonetizationPurchaseSurface, {
  type PlanFamily,
} from "@/components/monetization/MonetizationPurchaseSurface";

function normalizePlanFamilyInput(input: string | null | undefined): PlanFamily | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value === "af_pro" || value === "pro") return "af_pro";
  if (value === "af_commissioner" || value === "commissioner") return "af_commissioner";
  // "legacy" is the customer-facing name for the af_war_room family. Accepting it
  // lets marketing links use /upgrade?plan=legacy instead of leaking the internal
  // "war_room" key into a URL the customer can see (see lib/monetization/catalog.ts).
  if (value === "af_war_room" || value === "war_room" || value === "legacy") return "af_war_room";
  if (value === "af_supreme" || value === "supreme") return "af_supreme";
  if (value === "af_all_access" || value === "all_access") return "af_supreme";
  return null;
}

export default function UpgradePage({
  searchParams,
}: {
  searchParams?: { plan?: string };
}) {
  const focusPlanFamily = normalizePlanFamilyInput(searchParams?.plan);
  return (
    <MonetizationPurchaseSurface
      pagePath="/upgrade"
      title="Upgrade Your AllFantasy Access"
      subtitle="Unlock premium tools and planning workflows with monthly or yearly options."
      focusPlanFamily={focusPlanFamily}
    />
  );
}
