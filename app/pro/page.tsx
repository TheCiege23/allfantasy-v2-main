import MonetizationPurchaseSurface from "@/components/monetization/MonetizationPurchaseSurface";

export default function ProPage() {
  return (
    <MonetizationPurchaseSurface
      pagePath="/pro"
      title="Upgrade to AF Pro"
      subtitle="AF Pro is the player-specific Chimmy tier for trades, waivers, matchup explanations, recommendations, and planning."
      focusPlanFamily="af_pro"
    />
  );
}
