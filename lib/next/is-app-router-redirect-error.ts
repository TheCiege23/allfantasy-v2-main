/**
 * True when `error` is the special throw from `redirect()` in the App Router.
 * Use in catch blocks so redirect propagation is not mistaken for a data error.
 */
export function isAppRouterRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")
}

/**
 * True when `error` is one of the App Router's CONTROL-FLOW throws — the signal
 * `redirect()` or `notFound()` uses to unwind, not a failure.
 *
 * ⚠ WHY THIS EXISTS ALONGSIDE isAppRouterRedirectError RATHER THAN REPLACING IT.
 * That function is used in SERVER catch blocks, where the thrown object always
 * carries `digest` and re-throwing is the required behaviour. This one is for the
 * BROWSER's `window.error` handler, where the same signal arrives as an
 * ErrorEvent whose `error` may have been re-wrapped in transit and may carry only
 * the message. Testing the message as well is deliberate — a redirect that
 * reached the global handler with its digest stripped is exactly the case that
 * was being reported as a crash.
 *
 * `notFound()` is included for the same reason: it is a routing outcome the app
 * asked for, not an exception worth paging anyone about.
 */
export function isAppRouterControlFlowSignal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { digest?: unknown; message?: unknown }
  for (const field of [candidate.digest, candidate.message]) {
    if (typeof field !== "string") continue
    if (field.startsWith("NEXT_REDIRECT") || field.startsWith("NEXT_NOT_FOUND")) return true
  }
  return false
}
