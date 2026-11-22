import type { TradeCandidate } from "./apply-counter";

export function computeValueDeltaPct(c: TradeCandidate) {
  const youGive = sum(c.youSend);
  const youGet = sum(c.youReceive);

  if (youGive <= 0 || youGet <= 0) return 0;

  const delta = youGet - youGive;
  return Math.round((delta / Math.max(1, youGive)) * 100);
}

function sum(arr: Array<{ value?: number }>) {
  return (arr ?? []).reduce((acc, a) => acc + (a.value ?? 0), 0);
}

type FairnessLabel =
  | "FAIR"
  | "FAIR_UPSIDE_SKEWED"
  | "FAIR_DOWNSIDE_SKEWED"
  | "LEAN_YOU"
  | "LEAN_THEM"
  | "FLEECE_YOU"
  | "FLEECE_THEM";

export function previewFairnessLabel(deltaPct: number): FairnessLabel {
  const abs = Math.abs(deltaPct);

  if (abs <= 6) return "FAIR";
  if (abs <= 12) return deltaPct > 0 ? "FAIR_UPSIDE_SKEWED" : "FAIR_DOWNSIDE_SKEWED";
  if (abs <= 20) return deltaPct > 0 ? "LEAN_YOU" : "LEAN_THEM";
  return deltaPct > 0 ? "FLEECE_YOU" : "FLEECE_THEM";
}

export const FAIRNESS_DISPLAY: Record<FairnessLabel, { text: string; color: string }> = {
  FAIR: { text: "Fair Trade", color: "text-emerald-400" },
  FAIR_UPSIDE_SKEWED: { text: "Fair (Slight Edge)", color: "text-emerald-300" },
  FAIR_DOWNSIDE_SKEWED: { text: "Fair (Slight Overpay)", color: "text-amber-300" },
  LEAN_YOU: { text: "Leans Your Way", color: "text-cyan-300" },
  LEAN_THEM: { text: "Leans Their Way", color: "text-amber-400" },
  FLEECE_YOU: { text: "Big Win For You", color: "text-cyan-400" },
  FLEECE_THEM: { text: "Overpaying", color: "text-rose-400" },
};
