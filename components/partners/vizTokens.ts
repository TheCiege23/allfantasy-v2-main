/**
 * Chart tokens for the partner pages (dark site, cards on ~#0d1220).
 *
 * Series: the reference palette's first three dark slots, validated together against #0d1220
 * (dataviz validate_palette.js --mode dark --surface #0d1220: all checks pass, worst adjacent CVD ΔE 9.4).
 * Status colours are reserved for state and always ship with an icon and a label, never colour alone.
 */
export const VIZ = {
  surface: "#0d1220",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.45)",
  textPrimary: "#f0efec",
  textSecondary: "rgba(240,239,236,0.65)",
  textMuted: "rgba(240,239,236,0.45)",
  series1: "#3987e5", // blue
  series2: "#d95926", // orange
  series3: "#199e70", // aqua
  neutral: "#4a4a46", // "no response": a recessive gray, labelled in the legend
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
} as const
