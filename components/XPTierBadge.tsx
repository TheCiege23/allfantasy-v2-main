"use client"

/**
 * Displays current tier (Bronze GM → Legendary GM) with color.
 */
export function XPTierBadge({
  tier,
  tierBadgeColor,
  className = "",
}: {
  tier: string
  tierBadgeColor?: string
  className?: string
}) {
  const colorClass =
    tierBadgeColor === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : tierBadgeColor === "yellow"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
        : tierBadgeColor === "emerald"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : tierBadgeColor === "zinc"
            ? "border-zinc-400/30 bg-zinc-500/10 text-zinc-200"
            : tierBadgeColor === "orange"
              ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
              : "border-white/20 bg-white/5 text-white/70"

  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${colorClass} ${className}`}
      title={`Tier: ${tier}`}
    >
      {tier}
    </span>
  )
}
