/**
 * An NFL week line's league-scored number and the learned factors behind it. The factors were applied upstream to the
 * scored components (`applyNflFactors`), and league scoring is linear in them, so the number before the factors is
 * weekly ÷ multiplier. Without AF Intelligence the number before them is returned and no factors travel; with it, the
 * factors travel with `unadjusted.weekly` so the response gate can still revert them. PURE.
 */
export function nflWeeklyWithFactors(
  weekly: number | null,
  factors: { multiplier: number; reasons: string[] } | null | undefined,
  afIntelligence: boolean,
): { weekly: number | null; afFactors?: { multiplier: number; reasons: string[]; unadjusted: { weekly: number } } } {
  const m = factors?.multiplier
  if (weekly == null || m == null || !Number.isFinite(m) || m <= 0 || m === 1) return { weekly }
  const before = Math.round((weekly / m) * 100) / 100
  if (!afIntelligence) return { weekly: before }
  return { weekly, afFactors: { multiplier: m, reasons: factors!.reasons, unadjusted: { weekly: before } } }
}
