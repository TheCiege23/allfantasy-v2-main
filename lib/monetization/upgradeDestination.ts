import type { SubscriptionPlanFamily } from "@/lib/monetization/catalog"
import { HIGHLIGHT_TO_PLAN_FAMILY } from "@/lib/monetization/entitlements"

/**
 * Where an "upgrade" click lands.
 *
 * ⚠ `/upgrade?plan=<plan>` IS THE DESTINATION FOR A PLAN. It renders that plan
 * first, marked Recommended, with its own monthly and yearly Stripe buttons — one
 * click from checkout for the plan that unlocks the feature.
 *
 * Two pages look like destinations and are not:
 * - `/pricing` is the comparison grid. It does not sell AF Legacy at all (PricingV4
 *   LANE_ORDER), and it ignored `?plan=` and `?highlight=` — so a lock asking for a
 *   specific plan dropped the buyer on a grid with nothing picked out. It now
 *   forwards any such link here (`pricingIntentRedirect`).
 * - `/war-room` is AF Legacy's product page. Until 2026-09-24 every Legacy lock —
 *   four entitlements and 13 matrix features — sent buyers there, and it had no
 *   way to pay.
 */

/** The `?plan=` value `/upgrade` reads for each family. */
export const PLAN_QUERY_VALUE: Record<SubscriptionPlanFamily, string> = {
  af_pro: "pro",
  af_commissioner: "commissioner",
  af_war_room: "war_room",
  af_supreme: "supreme",
}

/**
 * Every spelling of a plan that links in this repo use.
 *
 * ⚠ HYPHENS ARE THE COMMON CASE, NOT AN EDGE: the World Cup surfaces and the
 * waiver locks all write `af-pro` / `af-commissioner`, which the old `/upgrade`
 * parser rejected, so those buyers landed with no plan focused.
 */
export function normalizePlanFamilyInput(input: unknown): SubscriptionPlanFamily | null {
  if (typeof input !== "string") return null
  const value = input.trim().toLowerCase().replace(/[\s-]+/g, "_")
  switch (value) {
    case "af_pro":
    case "pro":
      return "af_pro"
    case "af_commissioner":
    case "commissioner":
      return "af_commissioner"
    // Sold as "AF Legacy"; `war_room` is the stable internal key.
    case "af_war_room":
    case "war_room":
    case "af_legacy":
    case "legacy":
      return "af_war_room"
    // Legacy "all-access" deep links resolve to the surviving Supreme bundle.
    case "af_supreme":
    case "supreme":
    case "af_all_access":
    case "all_access":
      return "af_supreme"
    default:
      return null
  }
}

/** `/upgrade?plan=<plan>` plus any context (`feature`, `highlight`, `from`…). Empty values are dropped. */
export function upgradePathForPlan(
  family: SubscriptionPlanFamily,
  extra: Record<string, string | null | undefined> = {},
): string {
  const params = new URLSearchParams({ plan: PLAN_QUERY_VALUE[family] })
  for (const [key, value] of Object.entries(extra)) {
    if (key !== "plan" && value) params.set(key, value)
  }
  return `/upgrade?${params.toString()}`
}

type SearchParamsInput = Record<string, string | string[] | undefined> | null | undefined

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The `/upgrade` URL a `/pricing` link with a plan intent should have gone to, or
 * null when it names no plan — a bare `/pricing`, `?from=…` or `?msg=…` stays on
 * the grid.
 *
 * The intent is read from `?plan=`, then from `?highlight=` as a plan name
 * (`af-pro`, `supreme`), then from `?highlight=` as a feature key
 * (HIGHLIGHT_TO_PLAN_FAMILY). Every other parameter is carried across, so
 * `feature`, `from` and `intent` still reach analytics and the highlight still
 * rings its card.
 */
export function pricingIntentRedirect(searchParams: SearchParamsInput): string | null {
  if (!searchParams) return null
  const plan = first(searchParams.plan)
  const highlight = first(searchParams.highlight)
  const family =
    normalizePlanFamilyInput(plan) ??
    normalizePlanFamilyInput(highlight) ??
    (highlight ? HIGHLIGHT_TO_PLAN_FAMILY[highlight] ?? null : null)
  if (!family) return null

  const extra: Record<string, string> = {}
  for (const [key, value] of Object.entries(searchParams)) {
    const v = first(value)
    if (key !== "plan" && v) extra[key] = v
  }
  return upgradePathForPlan(family, extra)
}

/**
 * The path a purchase page should come back to — after Stripe (success or
 * cancel) and after sign-in: the page itself with the query that focused it.
 *
 * ⚠ RETURNING TO THE BARE PATH LOSES THE PLAN. `/upgrade` with no `?plan=` lists
 * AF Pro first, so a buyer who backed out of AF Legacy checkout, or who had to sign
 * in first, came back to a different plan than the one they chose.
 *
 * The purchase-result parameters are dropped. Stripe's return sets its own, and a
 * stale one carried through sign-in would show the last attempt's result again.
 * The list mirrors what `usePostPurchaseSync` clears once it has handled a return.
 */
const PURCHASE_RESULT_PARAMS = [
  "checkout",
  "success",
  "tokens",
  "purchased",
  "session_id",
  "sessionId",
  "status",
  "error",
  "cancel",
  "purchase",
  "payment",
] as const

export function purchaseReturnPath(
  pagePath: string,
  search: { toString(): string } | null | undefined,
): string {
  const params = new URLSearchParams(search ? search.toString() : "")
  for (const key of PURCHASE_RESULT_PARAMS) params.delete(key)
  const query = params.toString()
  return query ? `${pagePath}?${query}` : pagePath
}
