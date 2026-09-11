/**
 * The ONE conversion from waiver dollars to the app's 0–10000 trade-value scale.
 *
 * 🛑 THIS FILE EXISTS BECAUSE THERE WERE THREE OF THEM, AND THEY DISAGREED BY 28×.
 * Measured 2026-09-11, $10 of FAAB out of a $100 budget priced as:
 *
 *   /api/trade-evaluator             10   raw dollars added straight to a composite
 *                                         total whose players sit in the thousands —
 *                                         so FAAB was, in effect, worth nothing there
 *   lib/trade-value-console          280   round(amount / budget × 2800)
 *   lib/trade-value (canonical)      180   amount × 18, budget-blind
 *
 * All three feed the same 0–10000 FantasyCalc-convention scale, so the scale was never
 * the disagreement — the conversion was. Every caller now routes through this module.
 *
 * ── The formula ───────────────────────────────────────────────────────────────
 *   value = min(amount / budget, 1) × FAAB_FULL_BUDGET_VALUE
 *
 * It is BUDGET-RELATIVE on purpose: $10 is a tenth of a standard $100 budget and a
 * hundredth of a $1000 one, and pricing both at 180 says the two are the same asset.
 *
 * `FAAB_FULL_BUDGET_VALUE` is set so that this is byte-identical to the canonical
 * engine's previous `amount × 18` at the $100 budget — the Sleeper default, the
 * `League.waiverBudget` default, and the overwhelming majority of leagues here. The
 * calibration that was already in production is preserved; what changes is that a
 * league which is NOT on $100 stops being priced as though it were.
 *
 * ⚠ THIS IS STILL LINEAR, AND FAAB IS NOT A LINEAR ASSET. The last $10 of a budget in
 * week 12 is worth more than the first $10 in week 1, and $10 is worth more when every
 * rival is also broke. Modelling that needs the remaining-budget distribution, the
 * waiver pool, the week and the format — it is a marginal-option problem, not a
 * multiplier. Deliberately NOT attempted here: the defect being fixed is that three
 * call paths disagreed about units, and a better curve installed in one of them would
 * have recreated exactly that. Replace the body, keep the single definition site.
 */

/**
 * What an ENTIRE waiver budget is worth on the 0–10000 trade scale.
 *
 * 1800 ≈ a low-end startable flex piece. A whole budget is a real asset and not a
 * cornerstone one, which is the intent the previous constants encoded and which this
 * preserves at the default budget.
 */
export const FAAB_FULL_BUDGET_VALUE = 1800

/**
 * The budget assumed when a caller cannot tell us the real one.
 *
 * ⚠ A DEFAULT, NOT A MEASUREMENT — and it agrees with `League.waiverBudget`'s own
 * `@default(100)`, so a row that was never explicitly set prices the same either way.
 * A caller that KNOWS the budget must pass it; the point of this parameter is that the
 * fallback is visible in one place instead of being baked into three formulas.
 */
export const FAAB_DEFAULT_BUDGET = 100

/**
 * Value per dollar AT THE DEFAULT BUDGET ONLY — 18, the canonical engine's historical
 * constant, kept so the relationship to the old behaviour stays legible and testable.
 *
 * ⚠ DO NOT MULTIPLY BY THIS. It is only the per-dollar rate for a $100 league; use
 * `normalizedFaabValue`, which knows the league's actual budget.
 */
export const FAAB_VALUE_PER_DOLLAR = FAAB_FULL_BUDGET_VALUE / FAAB_DEFAULT_BUDGET

/**
 * Waiver dollars → the 0–10000 trade-value scale.
 *
 * @param amount  FAAB dollars changing hands. Non-finite or negative ⇒ 0.
 * @param budget  The league's FULL season waiver budget, not the remaining balance.
 *                Non-finite or non-positive ⇒ `FAAB_DEFAULT_BUDGET`.
 *
 * Capped at one full budget: a manager cannot trade away more FAAB than a budget, so a
 * larger `amount` is a bad input rather than a bigger asset. (The previous canonical
 * form clamped at 10000 instead, which let a nonsense $600 register as a cornerstone
 * player.)
 */
export function normalizedFaabValue(
  amount: number | null | undefined,
  budget?: number | null,
): number {
  const amt = Number.isFinite(amount as number) ? Math.max(0, amount as number) : 0
  const rawBudget = Number.isFinite(budget as number) ? (budget as number) : Number.NaN
  const effectiveBudget = rawBudget > 0 ? rawBudget : FAAB_DEFAULT_BUDGET
  const share = Math.min(amt / effectiveBudget, 1)
  return Math.round(share * FAAB_FULL_BUDGET_VALUE)
}
