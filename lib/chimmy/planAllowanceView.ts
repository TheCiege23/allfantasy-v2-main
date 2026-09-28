/**
 * The client half of `lib/chimmy/planAllowance.ts`: the shape the route sends in
 * `meta.planAllowance`, a validator for it, and the one sentence each state renders as.
 *
 * Kept free of server imports so the drawer can use it. The copy lives HERE, beside the validator,
 * so the answer footer and the composer note cannot describe the same allowance two ways.
 */

/**
 * How many Chimmy answers a day a plan with `ai_chat` includes (AF Pro; owner's decision 2026-09-24).
 *
 * ⚠ THE ONE PLACE THIS NUMBER IS WRITTEN. The allowance counter (`planAllowance.ts`) and the AF Pro
 * catalog description (`lib/monetization/catalog.ts`) both read it, so the price page cannot promise
 * one figure while the counter enforces another. Deliberately NOT env-tunable: an ops variable that
 * silently changes what the pricing page promises is the drift the catalog header already warns about.
 */
export const CHIMMY_PLAN_DAILY_INCLUDED = 100

export type ChimmyPlanAllowanceView = {
  /** True when this answer came out of the allowance; false when it was used up and tokens applied. */
  included: boolean
  planName: string
  used: number
  limit: number
  resetsAt: string
  /** An included answer that was not delivered, handed back. */
  released?: true
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Only a well-formed allowance survives; anything else renders nothing rather than a wrong count. */
export function readPlanAllowanceView(value: unknown): ChimmyPlanAllowanceView | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.included !== 'boolean') return null
  if (typeof v.planName !== 'string' || !v.planName.trim()) return null
  if (!isCount(v.used) || !isCount(v.limit) || v.limit <= 0) return null
  if (typeof v.resetsAt !== 'string') return null
  return {
    included: v.included,
    planName: v.planName.trim(),
    used: Math.min(Math.floor(v.used), Math.floor(v.limit)),
    limit: Math.floor(v.limit),
    resetsAt: v.resetsAt,
    ...(v.released === true ? { released: true as const } : {}),
  }
}

/** Under an answer: what this one did to the allowance. */
export function describeAnswerAllowance(view: ChimmyPlanAllowanceView): string {
  if (view.released) return `Not counted — ${view.used} of ${view.limit} ${view.planName} answers used today`
  if (view.included) return `Included with ${view.planName} · ${view.used} of ${view.limit} today`
  return `${view.planName}'s ${view.limit} daily answers are used — this one used tokens`
}

/** In the composer, before anything is sent. */
export function describeAllowanceNote(view: ChimmyPlanAllowanceView, tokenCost: number | null): string {
  const left = Math.max(0, view.limit - view.used)
  if (left > 0) {
    return `Included with ${view.planName}: ${left} of ${view.limit} Chimmy answers left today.` +
      (tokenCost != null ? ` After that, answers cost ${tokenCost} tokens.` : '')
  }
  return `Today's ${view.limit} ${view.planName} answers are used — they refill at midnight UTC.` +
    (tokenCost != null ? ` Until then, answers cost ${tokenCost} tokens.` : '')
}
