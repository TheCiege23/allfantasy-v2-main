/**
 * ChimmyFreshnessChip
 *
 * Small inline chip shown next to Chimmy AI messages in the pool chat.
 * Tells the user how fresh the data source was when Chimmy answered.
 *
 * Props:
 *   tier  — DataFreshnessTier string: "live" | "cached" | "schedule_only" | "pool_only" | "none"
 *   label — Short display text (e.g. "Live", "Cached · 8 min ago", "Pool data")
 *
 * Null/undefined tier defaults to "none" styles (greyed out).
 */

const FRESHNESS_CHIP_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  live:          { border: "border-emerald-400/40", bg: "bg-emerald-400/[0.12]", text: "text-emerald-300" },
  cached:        { border: "border-sky-400/35",     bg: "bg-sky-400/[0.10]",    text: "text-sky-300" },
  schedule_only: { border: "border-amber-400/35",   bg: "bg-amber-400/[0.10]",  text: "text-amber-300" },
  pool_only:     { border: "border-cyan-400/28",    bg: "bg-cyan-400/[0.08]",   text: "text-cyan-400/80" },
  none:          { border: "border-white/20",       bg: "bg-white/[0.06]",      text: "text-white/50" },
}

export function ChimmyFreshnessChip({ tier, label }: { tier: string | null | undefined; label: string }) {
  const style = FRESHNESS_CHIP_STYLES[tier ?? "none"] ?? FRESHNESS_CHIP_STYLES.none
  return (
    <span
      className={[
        "rounded-full border px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide",
        style.border,
        style.bg,
        style.text,
      ].join(" ")}
      aria-label={`Data source: ${label}`}
      data-testid="chimmy-freshness-chip"
    >
      {label}
    </span>
  )
}
