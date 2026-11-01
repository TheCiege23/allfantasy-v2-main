/**
 * The reception-scoring label for a per-catch rate: 1 → "PPR", 0.5 → "Half PPR", any other positive
 * rate → "<rate> PPR" (e.g. "0.25 PPR"), and null for none (standard scoring).
 *
 * ⚠ THE LABEL FOLLOWS THE RATE. `rate > 0 && 'PPR'` called a 0.5-a-catch league "PPR". Shared by the
 * Sleeper mapper (which writes `League.scoring`) and the import preview, so the two cannot disagree.
 */
export function receptionScoringLabel(rate: number | null | undefined): string | null {
  const r = Number(rate)
  if (!Number.isFinite(r) || r <= 0) return null
  if (r === 1) return 'PPR'
  if (r === 0.5) return 'Half PPR'
  return `${r} PPR`
}
